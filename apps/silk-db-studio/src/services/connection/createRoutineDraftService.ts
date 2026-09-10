import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { ConnectionService } from "./connectionService";
import { EditorConnectionBindingService } from "./editorConnectionBindingService";
import type { CreateTableTarget } from "./createTableSql";
import type { CreateRoutineKind } from "./createRoutineSql";
export type CreateRoutineDraft = CreateTableTarget & { kind: CreateRoutineKind; routineName: string; body: string; fullDefinition?: boolean };
const PREFIX = "silk://create-routine/"; const drafts = new Map<string, CreateRoutineDraft>();
export function isCreateRoutineDraftTab(uri?: string): boolean { return Boolean(uri?.startsWith(PREFIX)); }
export function parseCreateRoutineDraftUri(uri?: string): string | null { if (!uri?.startsWith(PREFIX)) return null; try { return decodeURIComponent(uri.slice(PREFIX.length)); } catch { return null; } }
export function getCreateRoutineDraft(id: string) { return drafts.get(id); }
export function updateCreateRoutineDraft(id: string, draft: CreateRoutineDraft) { drafts.set(id, draft); }
export function discardCreateRoutineDraft(id: string) { drafts.delete(id); }
export function openCreateRoutineDraft(target: CreateTableTarget, kind: CreateRoutineKind, initial?: Pick<CreateRoutineDraft, "routineName" | "body" | "fullDefinition">) { const profile = ConnectionService.getProfile(target.profileId); if (!profile) throw new Error("Connection profile was not found."); const id = crypto.randomUUID(); drafts.set(id, { ...target, kind, routineName: initial?.routineName ?? (kind === "procedure" ? "NEW_PROCEDURE" : "NEW_FUNCTION"), body: initial?.body ?? (kind === "procedure" ? "BEGIN\n  NULL;\nEND;" : "BEGIN\n  RETURN 0;\nEND;"), fullDefinition: initial?.fullDefinition }); const tabId = EditorService.openEditor({ uri: `${PREFIX}${encodeURIComponent(id)}`, label: initial ? `Copy of ${initial.routineName}` : (kind === "procedure" ? "New Procedure" : "New Function"), languageId: "plsql", content: "", preview: false }); EditorConnectionBindingService.setBinding(tabId, { profileId: target.profileId, catalog: target.catalogName, schema: target.schemaName }); EditorService.pinTab(tabId); EditorService.setTabDirtyOverride(tabId, true); }
