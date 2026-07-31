import type { Monaco } from "@monaco-editor/react";
import type { languages, Position, editor, IRange } from "monaco-editor";
import type { MetadataColumn } from "@silk-studio/db-protocol";
import { ConnectionService } from "../connection/connectionService";
import {
  detectSqlClause,
  extractCurrentStatement,
  type SqlClause,
} from "./sqlCompletionClause";
import {
  clearSqlCompletionCaches,
  ensureSchemaObjectsLoaded,
  ensureSchemasLoaded,
  findSchemaName,
  findTableInSchemas,
  getConnectedProfileIdForCompletion,
  getDefaultSchemaForCompletion,
  listColumnsCached,
  listSchemaNames,
  listTablesAndViews,
  resolveColumnsForTable,
  schemaCandidatesForCompletion,
} from "./sqlCompletionCatalog";
import {
  completionBucketsForClause,
  type SqlCompletionBucket,
} from "./sqlCompletionPolicy";
import { parseSqlCompletionContext } from "./sqlCompletionContext";
import {
  findRelationByQualifier,
  type SqlRelationRef,
} from "./sqlCompletionRelations";
import {
  bucketSortPrefix,
  capSuggestions,
  matchSortSuffix,
  MAX_COLUMN_SUGGESTIONS,
  MAX_FUNCTION_SUGGESTIONS,
  MAX_SCHEMA_SUGGESTIONS,
  MAX_TABLE_SUGGESTIONS,
  MAX_TOTAL_SUGGESTIONS,
} from "./sqlCompletionRanking";
import { parseSqlQueryScope, type SqlCteDef } from "./sqlCompletionScope";
import { isSqlLanguageId, resolveActiveDriverId } from "./sqlDialect";
import {
  expressionKeywordsForDriver,
  fromClauseKeywordsForDriver,
  selectListKeywords,
  statementStartKeywordsForDriver,
} from "./sqlKeywords";
import {
  findSqlFunction,
  parseFunctionCallAtCursor,
  sqlFunctionsForDriver,
} from "./sqlFunctions";

const SQL_LANGUAGE_IDS = [
  "sql",
  "plsql",
  "tsql",
  "mysql",
  "mariadb",
  "pgsql",
] as const;

let registered = false;
let disposables: { dispose(): void }[] = [];
let lastConnectedProfileId: string | null = null;
/** Drop stale async completion results when the user types faster than JDBC. */
let completionEpoch = 0;

export function registerSqlCompletion(monaco: Monaco): void {
  if (registered) return;
  registered = true;

  const provider: languages.CompletionItemProvider = {
    // Avoid firing on every space — `.` for qualifiers; Ctrl+Space / typing still works.
    triggerCharacters: ["."],
    provideCompletionItems: async (model, position, _context, token) => {
      if (!isSqlLanguageId(model.getLanguageId())) {
        return { suggestions: [] };
      }
      const epoch = ++completionEpoch;
      const suggestions = await buildSuggestions(monaco, model, position);
      if (token.isCancellationRequested || epoch !== completionEpoch) {
        return { suggestions: [] };
      }
      return { suggestions };
    },
  };

  for (const languageId of SQL_LANGUAGE_IDS) {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(languageId, provider),
    );
  }

  const signatureProvider: languages.SignatureHelpProvider = {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],
    provideSignatureHelp: (model, position) => {
      if (!isSqlLanguageId(model.getLanguageId())) {
        return null;
      }
      const textBeforeCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const call = parseFunctionCallAtCursor(textBeforeCursor);
      if (!call) return null;
      const def = findSqlFunction(resolveActiveDriverId(), call.name);
      if (!def?.signatures?.length) return null;

      return {
        value: {
          signatures: def.signatures.map((signature) => ({
            label: signature.label,
            documentation: def.documentation,
            parameters: signature.parameters.map((parameter) => ({
              label: parameter.label,
              documentation: parameter.documentation,
            })),
          })),
          activeSignature: 0,
          activeParameter: Math.min(
            call.activeParameter,
            Math.max(0, (def.signatures[0]?.parameters.length ?? 1) - 1),
          ),
        },
        dispose: () => {},
      };
    },
  };

  for (const languageId of SQL_LANGUAGE_IDS) {
    disposables.push(
      monaco.languages.registerSignatureHelpProvider(
        languageId,
        signatureProvider,
      ),
    );
  }

  ConnectionService.onDidChange(() => {
    const profileId = ConnectionService.getState().connectedProfileId;
    if (profileId !== lastConnectedProfileId) {
      lastConnectedProfileId = profileId;
      clearSqlCompletionCaches();
      completionEpoch += 1;
    }
  });
}

async function buildSuggestions(
  monaco: Monaco,
  model: editor.ITextModel,
  position: Position,
): Promise<languages.CompletionItem[]> {
  const linePrefix = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  const textBeforeCursor = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  const textAfterCursor = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: model.getLineCount(),
    endColumn: model.getLineMaxColumn(model.getLineCount()),
  });
  const { statement, prefix: statementPrefix } = extractCurrentStatement(
    textBeforeCursor,
    textAfterCursor,
  );
  const clause = detectSqlClause(statementPrefix);
  const buckets = completionBucketsForClause(clause);
  const { relations, visibleCtes } = parseSqlQueryScope(
    statement,
    statementPrefix.length,
  );

  const { qualifiers, partial } = parseSqlCompletionContext(linePrefix);
  const range = wordRange(model, position, partial);
  const driverId = resolveActiveDriverId();
  const profileId = getConnectedProfileIdForCompletion();

  if (qualifiers.length > 0) {
    const relation = findRelationByQualifier(relations, qualifiers[0]);
    if (qualifiers.length === 1 && relation?.columns?.length) {
      return finalizeSuggestions(
        columnSuggestions(
          monaco,
          range,
          relation.columns.map((name) => ({
            name,
            source: relationLabel(relation),
          })),
          partial,
          clause,
        ),
      );
    }
    if (!profileId) {
      return [];
    }
    return finalizeSuggestions(
      await dottedSuggestions(
        monaco,
        range,
        profileId,
        qualifiers,
        partial,
        relations,
        clause,
      ),
    );
  }

  const suggestions: languages.CompletionItem[] = [
    ...lexicalSuggestions(monaco, range, driverId, partial, buckets, clause),
  ];

  if (bucketsIncludes(buckets, "tables") && visibleCtes.length > 0) {
    suggestions.push(
      ...cteSuggestions(monaco, range, visibleCtes, partial, clause),
    );
  }

  if (!profileId) {
    if (bucketsIncludes(buckets, "columns")) {
      suggestions.push(
        ...syntheticScopedColumnSuggestions(
          monaco,
          range,
          relations,
          partial,
          clause,
        ),
      );
    }
    return finalizeSuggestions(suggestions);
  }

  await ensureSchemasLoaded(profileId);
  const schemaCandidates = schemaCandidatesForCompletion();

  if (bucketsIncludes(buckets, "schemas")) {
    suggestions.push(
      ...schemaSuggestions(monaco, range, profileId, partial, clause),
    );
  }

  if (bucketsIncludes(buckets, "tables")) {
    // Default schema first; only touch already-loaded extras (no N-schema storm).
    const preferred = schemaCandidates[0];
    const schemasToScan = preferred
      ? [
          preferred,
          ...schemaCandidates.slice(1).filter((schema) =>
            listTablesAndViews(profileId, schema).length > 0,
          ),
        ]
      : schemaCandidates.slice(0, 1);

    if (preferred) {
      await ensureSchemaObjectsLoaded(profileId, preferred);
    }
    for (const schema of schemasToScan) {
      suggestions.push(
        ...tableSuggestions(monaco, range, profileId, schema, partial, clause),
      );
    }
  }

  if (bucketsIncludes(buckets, "columns")) {
    suggestions.push(
      ...(await scopedColumnSuggestions(
        monaco,
        range,
        profileId,
        relations,
        partial,
        clause,
      )),
    );
  }

  return finalizeSuggestions(suggestions);
}

function finalizeSuggestions(
  items: languages.CompletionItem[],
): languages.CompletionItem[] {
  return capSuggestions(dedupeByLabel(items), MAX_TOTAL_SUGGESTIONS);
}

async function dottedSuggestions(
  monaco: Monaco,
  range: IRange,
  profileId: string,
  qualifiers: string[],
  partial: string,
  relations: SqlRelationRef[],
  clause: SqlClause,
): Promise<languages.CompletionItem[]> {
  await ensureSchemasLoaded(profileId);
  const defaultSchema = getDefaultSchemaForCompletion();
  const schemaCandidates = schemaCandidatesForCompletion();

  if (qualifiers.length === 1) {
    const head = qualifiers[0];

    const relation = findRelationByQualifier(relations, head);
    if (relation) {
      const columns = await resolveColumnsForRelation(profileId, relation);
      return columnSuggestions(
        monaco,
        range,
        columns.map((column) => ({
          ...column,
          source: relationLabel(relation),
        })),
        partial,
        clause,
      );
    }

    const schemaMatch = findSchemaName(profileId, head);

    if (schemaMatch) {
      await ensureSchemaObjectsLoaded(profileId, schemaMatch);
      const alsoTable = findTableInSchemas(profileId, head, defaultSchema);
      if (!alsoTable) {
        return tableSuggestions(
          monaco,
          range,
          profileId,
          schemaMatch,
          partial,
          clause,
        );
      }
      const columns = await resolveColumnsForTable(profileId, head);
      if (columns.length > 0) {
        return columnSuggestions(monaco, range, columns, partial, clause);
      }
      return tableSuggestions(
        monaco,
        range,
        profileId,
        schemaMatch,
        partial,
        clause,
      );
    }

    // Warm preferred schema only; avoid loading every candidate schema.
    if (schemaCandidates[0]) {
      await ensureSchemaObjectsLoaded(profileId, schemaCandidates[0]);
    }
    const columns = await resolveColumnsForTable(profileId, head);
    return columnSuggestions(monaco, range, columns, partial, clause);
  }

  const schemaName = findSchemaName(profileId, qualifiers[0]) ?? qualifiers[0];
  const tableName = qualifiers[1];
  await ensureSchemaObjectsLoaded(profileId, schemaName);
  const resolved =
    findTableInSchemas(profileId, tableName, schemaName) ?? {
      schema: schemaName,
      table: tableName,
    };
  const columns = await listColumnsCached(resolved.schema, resolved.table);
  return columnSuggestions(monaco, range, columns, partial, clause);
}

async function resolveColumnsForRelation(
  profileId: string,
  relation: SqlRelationRef,
): Promise<MetadataColumn[]> {
  if (relation.columns && relation.columns.length > 0) {
    return relation.columns.map((name) => ({ name }));
  }
  if (relation.schema) {
    await ensureSchemaObjectsLoaded(profileId, relation.schema);
    const columns = await listColumnsCached(relation.schema, relation.table);
    if (columns.length > 0) return columns;
  }
  return resolveColumnsForTable(profileId, relation.table);
}

function syntheticScopedColumnSuggestions(
  monaco: Monaco,
  range: IRange,
  relations: SqlRelationRef[],
  partial: string,
  clause: SqlClause,
): languages.CompletionItem[] {
  type Sourced = { name: string; source: string; sources: string[] };
  const byName = new Map<string, Sourced>();
  for (const relation of relations) {
    if (!relation.columns?.length) continue;
    const source = relationLabel(relation);
    for (const name of relation.columns) {
      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { name, source, sources: [source] });
      } else if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
    }
  }
  return columnSuggestions(
    monaco,
    range,
    [...byName.values()].map((column) => ({
      name: column.name,
      source:
        column.sources.length > 1
          ? column.sources.join(" · ")
          : column.source,
    })),
    partial,
    clause,
  );
}

function cteSuggestions(
  monaco: Monaco,
  range: IRange,
  ctes: SqlCteDef[],
  partial: string,
  clause: SqlClause,
): languages.CompletionItem[] {
  const needle = partial.toLowerCase();
  const sortPrefix = bucketSortPrefix(clause, "tables");
  return capSuggestions(
    ctes
      .filter((cte) => !needle || cte.name.toLowerCase().startsWith(needle))
      .map((cte) => ({
        label: cte.name,
        kind: monaco.languages.CompletionItemKind.Struct,
        insertText: cte.name,
        range,
        filterText: cte.name,
        detail:
          cte.columns.length > 0
            ? `cte · ${cte.columns.join(", ")}`
            : "cte",
        sortText: `${sortPrefix}_${matchSortSuffix(cte.name, partial)}`,
      })),
    MAX_TABLE_SUGGESTIONS,
  );
}

async function scopedColumnSuggestions(
  monaco: Monaco,
  range: IRange,
  profileId: string,
  relations: SqlRelationRef[],
  partial: string,
  clause: SqlClause,
): Promise<languages.CompletionItem[]> {
  if (relations.length === 0) {
    return [];
  }

  type Sourced = MetadataColumn & { source: string; sources: string[] };
  const byName = new Map<string, Sourced>();

  const resolved = await Promise.all(
    relations.map(async (relation) => ({
      relation,
      columns: await resolveColumnsForRelation(profileId, relation),
    })),
  );

  for (const { relation, columns } of resolved) {
    const source = relationLabel(relation);
    for (const column of columns) {
      const key = column.name.toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { ...column, source, sources: [source] });
      } else if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
    }
  }

  return columnSuggestions(
    monaco,
    range,
    [...byName.values()].map((column) => ({
      name: column.name,
      typeName: column.typeName,
      source:
        column.sources.length > 1
          ? column.sources.join(" · ")
          : column.source,
    })),
    partial,
    clause,
  );
}

function relationLabel(relation: SqlRelationRef): string {
  const table = relation.schema
    ? `${relation.schema}.${relation.table}`
    : relation.table;
  if (relation.alias.toLowerCase() === relation.table.toLowerCase()) {
    return table;
  }
  return `${table} ${relation.alias}`;
}

function bucketsIncludes(
  buckets: readonly SqlCompletionBucket[],
  bucket: SqlCompletionBucket,
): boolean {
  return buckets.includes(bucket);
}

function lexicalSuggestions(
  monaco: Monaco,
  range: IRange,
  driverId: ReturnType<typeof resolveActiveDriverId>,
  partial: string,
  buckets: readonly SqlCompletionBucket[],
  clause: SqlClause,
): languages.CompletionItem[] {
  const items: languages.CompletionItem[] = [];

  if (bucketsIncludes(buckets, "statement_start_keywords")) {
    items.push(
      ...wordSuggestions(
        monaco,
        range,
        statementStartKeywordsForDriver(driverId),
        partial,
        "keyword",
        monaco.languages.CompletionItemKind.Keyword,
        bucketSortPrefix(clause, "statement_start_keywords"),
      ),
    );
  }
  if (bucketsIncludes(buckets, "from_keywords")) {
    items.push(
      ...wordSuggestions(
        monaco,
        range,
        fromClauseKeywordsForDriver(driverId),
        partial,
        "keyword",
        monaco.languages.CompletionItemKind.Keyword,
        bucketSortPrefix(clause, "from_keywords"),
      ),
    );
  }
  if (bucketsIncludes(buckets, "select_list_keywords")) {
    items.push(
      ...wordSuggestions(
        monaco,
        range,
        selectListKeywords(),
        partial,
        "keyword",
        monaco.languages.CompletionItemKind.Keyword,
        bucketSortPrefix(clause, "select_list_keywords"),
      ),
    );
  }
  if (bucketsIncludes(buckets, "expression_keywords")) {
    items.push(
      ...wordSuggestions(
        monaco,
        range,
        expressionKeywordsForDriver(driverId),
        partial,
        "keyword",
        monaco.languages.CompletionItemKind.Keyword,
        bucketSortPrefix(clause, "expression_keywords"),
      ),
    );
  }
  if (bucketsIncludes(buckets, "functions")) {
    items.push(...functionSuggestions(monaco, range, driverId, partial, clause));
  }

  return items;
}

function functionSuggestions(
  monaco: Monaco,
  range: IRange,
  driverId: ReturnType<typeof resolveActiveDriverId>,
  partial: string,
  clause: SqlClause,
): languages.CompletionItem[] {
  const needle = partial.toLowerCase();
  const sortPrefix = bucketSortPrefix(clause, "functions");
  return capSuggestions(
    sqlFunctionsForDriver(driverId)
      .filter((def) => !needle || def.name.toLowerCase().startsWith(needle))
      .map((def) => {
        const useSnippet =
          def.insertText.includes("$") || def.insertText.includes("(");
        return {
          label: def.name,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: def.insertText,
          insertTextRules: useSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          range,
          filterText: def.name,
          detail: def.detail,
          documentation: def.documentation,
          sortText: `${sortPrefix}_${matchSortSuffix(def.name, partial)}`,
        };
      }),
    MAX_FUNCTION_SUGGESTIONS,
  );
}

function wordSuggestions(
  monaco: Monaco,
  range: IRange,
  words: string[],
  partial: string,
  detail: string,
  kind: languages.CompletionItemKind,
  sortPrefix: string,
): languages.CompletionItem[] {
  const needle = partial.toLowerCase();
  return words
    .filter((word) => !needle || word.toLowerCase().startsWith(needle))
    .map((word) => ({
      label: word,
      kind,
      insertText: word,
      range,
      filterText: word,
      detail,
      sortText: `${sortPrefix}_${matchSortSuffix(word, partial)}`,
    }));
}

function schemaSuggestions(
  monaco: Monaco,
  range: IRange,
  profileId: string,
  partial: string,
  clause: SqlClause,
): languages.CompletionItem[] {
  const needle = partial.toLowerCase();
  const sortPrefix = bucketSortPrefix(clause, "schemas");
  return capSuggestions(
    listSchemaNames(profileId)
      .filter((name) => !needle || name.toLowerCase().startsWith(needle))
      .map((name) => ({
        label: name,
        kind: monaco.languages.CompletionItemKind.Module,
        insertText: name,
        range,
        filterText: name,
        detail: "schema",
        sortText: `${sortPrefix}_${matchSortSuffix(name, partial)}`,
      })),
    MAX_SCHEMA_SUGGESTIONS,
  );
}

function tableSuggestions(
  monaco: Monaco,
  range: IRange,
  profileId: string,
  schemaName: string,
  partial: string,
  clause: SqlClause,
): languages.CompletionItem[] {
  const needle = partial.toLowerCase();
  const sortPrefix = bucketSortPrefix(clause, "tables");
  return capSuggestions(
    listTablesAndViews(profileId, schemaName)
      .filter(
        (object) => !needle || object.name.toLowerCase().startsWith(needle),
      )
      .map((object) => ({
        label: object.name,
        kind:
          object.kind === "view"
            ? monaco.languages.CompletionItemKind.Interface
            : monaco.languages.CompletionItemKind.Class,
        insertText: object.name,
        range,
        filterText: object.name,
        detail: `${object.kind} · ${schemaName}`,
        sortText: `${sortPrefix}_${matchSortSuffix(object.name, partial)}`,
      })),
    MAX_TABLE_SUGGESTIONS,
  );
}

function columnSuggestions(
  monaco: Monaco,
  range: IRange,
  columns: { name: string; typeName?: string; source?: string }[],
  partial: string,
  clause: SqlClause = "unknown",
): languages.CompletionItem[] {
  const needle = partial.toLowerCase();
  const sortPrefix = bucketSortPrefix(clause, "columns");
  return capSuggestions(
    columns
      .filter(
        (column) => !needle || column.name.toLowerCase().startsWith(needle),
      )
      .map((column) => {
        const parts = ["column"];
        if (column.source) parts.push(column.source);
        if (column.typeName) parts.push(column.typeName);
        return {
          label: column.name,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: column.name,
          range,
          filterText: column.name,
          detail: parts.join(" · "),
          sortText: `${sortPrefix}_${matchSortSuffix(column.name, partial)}`,
        };
      }),
    MAX_COLUMN_SUGGESTIONS,
  );
}

function wordRange(
  model: editor.ITextModel,
  position: Position,
  partial: string,
): IRange {
  if (partial) {
    return {
      startLineNumber: position.lineNumber,
      startColumn: position.column - partial.length,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    };
  }
  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: word.endColumn,
  };
}

function dedupeByLabel(
  items: languages.CompletionItem[],
): languages.CompletionItem[] {
  const seen = new Set<string>();
  const result: languages.CompletionItem[] = [];
  for (const item of items) {
    const key = String(item.label).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** Exposed for tests / cleanup; currently unused by the app shell. */
export function disposeSqlCompletion(): void {
  for (const disposable of disposables) {
    disposable.dispose();
  }
  disposables = [];
  registered = false;
  completionEpoch = 0;
  clearSqlCompletionCaches();
}
