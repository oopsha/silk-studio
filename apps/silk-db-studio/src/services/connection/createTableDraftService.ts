import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { monacoLanguageIdForDriver } from "../sql/sqlDialect";
import { ConnectionService } from "./connectionService";
import { EditorConnectionBindingService } from "./editorConnectionBindingService";
import type { CreateTableDraft, CreateTableTarget } from "./createTableSql";

export type CreateTableDraftInitialValues = Pick<
  CreateTableDraft,
  "tableName" | "tableComment" | "columns"
>;

export const CREATE_TABLE_DRAFT_URI_PREFIX = "silk://create-table/";

const drafts = new Map<string, CreateTableDraft>();
const listeners = new Set<() => void>();

function fireDidChange(): void {
  for (const listener of listeners) listener();
}

/** Lets external target pickers update a visible draft without owning its React state. */
export function onDidChangeCreateTableDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createTableDraftUri(id: string): string {
  return `${CREATE_TABLE_DRAFT_URI_PREFIX}${encodeURIComponent(id)}`;
}

export function parseCreateTableDraftUri(uri: string | undefined): string | null {
  if (!uri?.startsWith(CREATE_TABLE_DRAFT_URI_PREFIX)) return null;
  try {
    return decodeURIComponent(uri.slice(CREATE_TABLE_DRAFT_URI_PREFIX.length)) || null;
  } catch {
    return null;
  }
}

export function isCreateTableDraftTab(uri: string | undefined): boolean {
  return parseCreateTableDraftUri(uri) !== null;
}

export function getCreateTableDraft(id: string): CreateTableDraft | undefined {
  return drafts.get(id);
}

export function updateCreateTableDraft(id: string, draft: CreateTableDraft): void {
  drafts.set(id, draft);
  fireDidChange();
}

export function discardCreateTableDraft(id: string): void {
  drafts.delete(id);
  fireDidChange();
}

export function openCreateTableDraft(
  target: CreateTableTarget,
  initial?: CreateTableDraftInitialValues,
): void {
  const profile = ConnectionService.getProfile(target.profileId);
  if (!profile) throw new Error("Connection profile was not found.");
  const id = crypto.randomUUID();
  drafts.set(id, {
    ...target,
    tableName: initial?.tableName ?? "",
    tableComment: initial?.tableComment,
    columns: initial?.columns ?? [],
  });
  fireDidChange();
  const tabId = EditorService.openEditor({
    uri: createTableDraftUri(id),
    label: initial ? `Copy of ${initial.tableName}` : "New Table",
    languageId: monacoLanguageIdForDriver(profile.driverId),
    content: "",
    preview: false,
  });
  // The draft is an object editor rather than a SQL text tab, but execution still follows the
  // active editor binding for catalog/schema session setup. Bind the exact explorer target.
  EditorConnectionBindingService.setBinding(tabId, {
    profileId: target.profileId,
    catalog: target.catalogName,
    schema: target.schemaName,
  });
  EditorService.pinTab(tabId);
  // A draft has no persisted database object yet, even before a column is added.
  // Mark it dirty immediately so closing the new-table tab always asks before discarding it.
  EditorService.setTabDirtyOverride(tabId, true);
}
