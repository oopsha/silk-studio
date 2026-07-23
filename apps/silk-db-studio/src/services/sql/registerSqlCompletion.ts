import type { Monaco } from "@monaco-editor/react";
import type { languages, Position, editor, IRange } from "monaco-editor";
import { ConnectionService } from "../connection/connectionService";
import { parseSqlCompletionContext } from "./sqlCompletionContext";
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
import { isSqlLanguageId, resolveActiveDriverId } from "./sqlDialect";
import { keywordsForDriver } from "./sqlKeywords";

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

export function registerSqlCompletion(monaco: Monaco): void {
  if (registered) return;
  registered = true;

  const provider: languages.CompletionItemProvider = {
    triggerCharacters: [".", " "],
    provideCompletionItems: async (model, position) => {
      if (!isSqlLanguageId(model.getLanguageId())) {
        return { suggestions: [] };
      }
      return {
        suggestions: await buildSuggestions(monaco, model, position),
      };
    },
  };

  for (const languageId of SQL_LANGUAGE_IDS) {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(languageId, provider),
    );
  }

  ConnectionService.onDidChange(() => {
    const profileId = ConnectionService.getState().connectedProfileId;
    if (profileId !== lastConnectedProfileId) {
      lastConnectedProfileId = profileId;
      clearSqlCompletionCaches();
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
  const { qualifiers, partial } = parseSqlCompletionContext(linePrefix);
  const range = wordRange(model, position, partial);
  const driverId = resolveActiveDriverId();
  const profileId = getConnectedProfileIdForCompletion();

  if (!profileId) {
    return keywordSuggestions(monaco, range, driverId, partial);
  }

  await ensureSchemasLoaded(profileId);
  const defaultSchema = getDefaultSchemaForCompletion();
  const schemaCandidates = schemaCandidatesForCompletion();

  if (qualifiers.length === 0) {
    const suggestions = [
      ...keywordSuggestions(monaco, range, driverId, partial),
      ...schemaSuggestions(monaco, range, profileId, partial),
    ];
    for (const schema of schemaCandidates) {
      await ensureSchemaObjectsLoaded(profileId, schema);
      suggestions.push(
        ...tableSuggestions(monaco, range, profileId, schema, partial),
      );
    }
    return dedupeByLabel(suggestions);
  }

  if (qualifiers.length === 1) {
    const head = qualifiers[0];
    const schemaMatch = findSchemaName(profileId, head);

    // If `head` is a known schema, prefer table suggestions — unless it is also a
    // table/view under the default schema (then columns are more useful after `table.`).
    if (schemaMatch) {
      for (const schema of schemaCandidates) {
        await ensureSchemaObjectsLoaded(profileId, schema);
      }
      const alsoTable = findTableInSchemas(profileId, head, defaultSchema);
      if (!alsoTable) {
        await ensureSchemaObjectsLoaded(profileId, schemaMatch);
        return tableSuggestions(
          monaco,
          range,
          profileId,
          schemaMatch,
          partial,
        );
      }
      // Name is both schema and table: offer columns for the table resolution.
      const columns = await resolveColumnsForTable(profileId, head);
      if (columns.length > 0) {
        return columnSuggestions(monaco, range, columns, partial);
      }
      await ensureSchemaObjectsLoaded(profileId, schemaMatch);
      return tableSuggestions(monaco, range, profileId, schemaMatch, partial);
    }

    const columns = await resolveColumnsForTable(profileId, head);
    return columnSuggestions(monaco, range, columns, partial);
  }

  // schema.table.column…
  const schemaName = findSchemaName(profileId, qualifiers[0]) ?? qualifiers[0];
  const tableName = qualifiers[1];
  await ensureSchemaObjectsLoaded(profileId, schemaName);
  const resolved =
    findTableInSchemas(profileId, tableName, schemaName) ?? {
      schema: schemaName,
      table: tableName,
    };
  const columns = await listColumnsCached(resolved.schema, resolved.table);
  return columnSuggestions(monaco, range, columns, partial);
}

function keywordSuggestions(
  monaco: Monaco,
  range: IRange,
  driverId: ReturnType<typeof resolveActiveDriverId>,
  partial: string,
): languages.CompletionItem[] {
  const needle = partial.toLowerCase();
  return keywordsForDriver(driverId)
    .filter((keyword) => !needle || keyword.toLowerCase().startsWith(needle))
    .map((keyword) => ({
      label: keyword,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: keyword,
      range,
      detail: "keyword",
      sortText: `0_${keyword}`,
    }));
}

function schemaSuggestions(
  monaco: Monaco,
  range: IRange,
  profileId: string,
  partial: string,
): languages.CompletionItem[] {
  const needle = partial.toLowerCase();
  return listSchemaNames(profileId)
    .filter((name) => !needle || name.toLowerCase().startsWith(needle))
    .map((name) => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Module,
      insertText: name,
      range,
      detail: "schema",
      sortText: `1_${name}`,
    }));
}

function tableSuggestions(
  monaco: Monaco,
  range: IRange,
  profileId: string,
  schemaName: string,
  partial: string,
): languages.CompletionItem[] {
  const needle = partial.toLowerCase();
  return listTablesAndViews(profileId, schemaName)
    .filter((object) => !needle || object.name.toLowerCase().startsWith(needle))
    .map((object) => ({
      label: object.name,
      kind:
        object.kind === "view"
          ? monaco.languages.CompletionItemKind.Interface
          : monaco.languages.CompletionItemKind.Class,
      insertText: object.name,
      range,
      detail: `${object.kind} · ${schemaName}`,
      sortText: `2_${object.name}`,
    }));
}

function columnSuggestions(
  monaco: Monaco,
  range: IRange,
  columns: { name: string; typeName?: string }[],
  partial: string,
): languages.CompletionItem[] {
  const needle = partial.toLowerCase();
  return columns
    .filter((column) => !needle || column.name.toLowerCase().startsWith(needle))
    .map((column) => ({
      label: column.name,
      kind: monaco.languages.CompletionItemKind.Field,
      insertText: column.name,
      range,
      detail: column.typeName ? `column · ${column.typeName}` : "column",
      sortText: `3_${column.name}`,
    }));
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
  clearSqlCompletionCaches();
}
