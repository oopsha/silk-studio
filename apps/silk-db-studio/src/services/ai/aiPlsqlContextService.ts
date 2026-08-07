import type { ConnectionDependency } from "@silk-studio/db-protocol";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { bridgeListColumns } from "../connection/connectionBridge";
import { bridgeListObjectDependencies } from "../connection/connectionDependenciesBridge";
import { ConnectionService } from "../connection/connectionService";
import {
  parsePlsqlEditorUri,
  PLSQL_SOURCE_LOADING,
  type PlsqlEditorRef,
} from "../connection/plsqlEditorConstants";

const LIMITS = {
  maxTabs: 5,
  sourceCharsPerTab: 2_500,
  maxDepsListed: 40,
  maxTablesWithColumns: 8,
  maxColumnsPerTable: 24,
} as const;

function truncate(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1))}…`;
}

function objectLabel(ref: PlsqlEditorRef): string {
  const kind =
    ref.kind === "package"
      ? ref.packageBody
        ? "PACKAGE BODY"
        : "PACKAGE"
      : ref.kind.toUpperCase();
  return `${ref.schemaName}.${ref.objectName} (${kind})`;
}

function isTableOrView(type: string): boolean {
  const upper = type.trim().toUpperCase();
  return upper === "TABLE" || upper === "VIEW";
}

function dependencyKey(dep: ConnectionDependency): string {
  return `${dep.schema.toUpperCase()}\0${dep.name.toUpperCase()}\0${dep.type.toUpperCase()}`;
}

/**
 * Build an AI context block from open PL/SQL editor tabs (same profile as
 * {@code profileId}), including buffer source, ALL_DEPENDENCIES, and columns
 * for referenced tables/views.
 */
export async function buildOpenPlsqlContextText(
  profileId: string | null | undefined,
  maxChars: number,
): Promise<string | null> {
  const id = profileId?.trim();
  if (!id || !ConnectionService.isConnected(id)) {
    return null;
  }

  const activeTabId = EditorService.getActiveTabId();
  const activeSnapshot =
    EditorService.getActiveTab()?.id === activeTabId
      ? EditorService.getActiveEditorSnapshot()
      : null;

  const candidates = EditorService.getTabs()
    .map((tab) => {
      const ref = parsePlsqlEditorUri(tab.uri);
      if (!ref || ref.profileId !== id) return null;
      if (tab.content.trim() === PLSQL_SOURCE_LOADING.trim()) return null;
      return { tab, ref };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (candidates.length === 0) {
    return null;
  }

  // Prefer active tab first, then keep open order.
  candidates.sort((a, b) => {
    const aActive = a.tab.id === activeTabId ? 0 : 1;
    const bActive = b.tab.id === activeTabId ? 0 : 1;
    return aActive - bActive;
  });

  const selected = candidates.slice(0, LIMITS.maxTabs);
  const omitted = candidates.length - selected.length;

  const header = [
    "### Open PL/SQL objects",
    "The following sources and dependency/column lists come from the database (compile-time metadata).",
    "Do not invent objects or columns that are not listed. Dynamic SQL may be missing from dependencies.",
  ];

  const blocks: string[] = [];
  let used = header.join("\n").length;

  for (const { tab, ref } of selected) {
    const active = tab.id === activeTabId;
    const source =
      active && activeSnapshot
        ? activeSnapshot.content
        : tab.content;
    const packageBody =
      ref.kind === "package" ? ref.packageBody === true : undefined;

    let deps: ConnectionDependency[] = [];
    let depsError: string | null = null;
    try {
      const result = await bridgeListObjectDependencies(
        id,
        ref.schemaName,
        ref.objectName,
        ref.kind,
        packageBody,
      );
      deps = result.dependencies;
    } catch (error) {
      depsError =
        error instanceof Error ? error.message : "Failed to load dependencies.";
    }

    const depLines =
      deps.length === 0
        ? depsError
          ? [`- (dependencies unavailable: ${depsError})`]
          : ["- (none returned)"]
        : deps.slice(0, LIMITS.maxDepsListed).map((dep) => {
            const soft = dep.dependencyType
              ? ` [${dep.dependencyType}]`
              : "";
            return `- ${dep.schema}.${dep.name} ${dep.type}${soft}`;
          });
    if (deps.length > LIMITS.maxDepsListed) {
      depLines.push(
        `- … ${deps.length - LIMITS.maxDepsListed} more dependencies omitted`,
      );
    }

    const tableViews = deps
      .filter((dep) => isTableOrView(dep.type))
      .filter(
        (dep, index, all) =>
          all.findIndex((other) => dependencyKey(other) === dependencyKey(dep)) ===
          index,
      )
      .slice(0, LIMITS.maxTablesWithColumns);

    const columnBlocks: string[] = [];
    for (const dep of tableViews) {
      try {
        const columns = await bridgeListColumns(id, dep.schema, dep.name);
        const listed = columns.columns.slice(0, LIMITS.maxColumnsPerTable);
        const colText = listed
          .map((col) =>
            col.typeName ? `${col.name} ${col.typeName}` : col.name,
          )
          .join(", ");
        const more =
          columns.columns.length > LIMITS.maxColumnsPerTable
            ? ` (+${columns.columns.length - LIMITS.maxColumnsPerTable} more)`
            : "";
        columnBlocks.push(
          `#### ${dep.schema}.${dep.name} (${dep.type})\n${colText || "(no columns)"}${more}`,
        );
      } catch {
        columnBlocks.push(
          `#### ${dep.schema}.${dep.name} (${dep.type})\n(columns unavailable)`,
        );
      }
    }

    const objectHeader = `#### ${objectLabel(ref)}${active ? " (active)" : ""}${
      tab.isDirty ? " [dirty buffer — deps are from DB]" : ""
    }`;
    const sourceBlock = [
      objectHeader,
      "```plsql",
      truncate(source, LIMITS.sourceCharsPerTab),
      "```",
      "Dependencies:",
      ...depLines,
      ...(columnBlocks.length > 0
        ? ["Referenced table/view columns:", ...columnBlocks]
        : []),
    ].join("\n");

    if (used + sourceBlock.length + 2 > maxChars && blocks.length > 0) {
      blocks.push("… additional open PL/SQL tabs omitted (context limit)");
      break;
    }
    blocks.push(sourceBlock);
    used += sourceBlock.length + 2;
  }

  if (blocks.length === 0) {
    return null;
  }

  const footer =
    omitted > 0
      ? `\n… ${omitted} more open PL/SQL tab(s) omitted (max ${LIMITS.maxTabs})`
      : "";

  return truncate(`${header.join("\n")}\n\n${blocks.join("\n\n")}${footer}`, maxChars);
}
