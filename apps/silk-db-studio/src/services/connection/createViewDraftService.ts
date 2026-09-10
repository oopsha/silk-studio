import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { monacoLanguageIdForDriver } from "../sql/sqlDialect";
import { ConnectionService } from "./connectionService";
import { EditorConnectionBindingService } from "./editorConnectionBindingService";
import type { CreateTableTarget } from "./createTableSql";

export type CreateViewDraft = CreateTableTarget & { viewName: string; definition: string };
export const CREATE_VIEW_DRAFT_URI_PREFIX = "silk://create-view/";
const drafts = new Map<string, CreateViewDraft>();

export function parseCreateViewDraftUri(uri: string | undefined): string | null {
  if (!uri?.startsWith(CREATE_VIEW_DRAFT_URI_PREFIX)) return null;
  try { return decodeURIComponent(uri.slice(CREATE_VIEW_DRAFT_URI_PREFIX.length)) || null; } catch { return null; }
}
export function isCreateViewDraftTab(uri: string | undefined): boolean { return parseCreateViewDraftUri(uri) !== null; }
export function getCreateViewDraft(id: string): CreateViewDraft | undefined { return drafts.get(id); }
export function updateCreateViewDraft(id: string, draft: CreateViewDraft): void { drafts.set(id, draft); }
export function discardCreateViewDraft(id: string): void { drafts.delete(id); }

export function openCreateViewDraft(target: CreateTableTarget, initial?: Pick<CreateViewDraft, "viewName" | "definition">): void {
  const profile = ConnectionService.getProfile(target.profileId);
  if (!profile) throw new Error("Connection profile was not found.");
  const id = crypto.randomUUID();
  drafts.set(id, { ...target, viewName: initial?.viewName ?? "NEW_VIEW", definition: initial?.definition ?? "SELECT 1 AS value" });
  const tabId = EditorService.openEditor({ uri: `${CREATE_VIEW_DRAFT_URI_PREFIX}${encodeURIComponent(id)}`, label: initial ? `Copy of ${initial.viewName}` : "New View", languageId: monacoLanguageIdForDriver(profile.driverId), content: "", preview: false });
  EditorConnectionBindingService.setBinding(tabId, { profileId: target.profileId, catalog: target.catalogName, schema: target.schemaName });
  EditorService.pinTab(tabId);
  EditorService.setTabDirtyOverride(tabId, true);
}
