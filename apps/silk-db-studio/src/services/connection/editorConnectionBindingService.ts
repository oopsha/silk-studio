import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import { ConnectionService } from "./connectionService";
import { effectiveDefaultSchema } from "./connectionTypes";
import { isSqlLanguageId } from "../sql/sqlDialect";
import { parseObjectEditorUri } from "./objectEditorConstants";
import { parseDdlEditorUri } from "./ddlEditorConstants";
import { parsePlsqlEditorUri } from "./plsqlEditorConstants";

export type EditorConnectionBinding = {
  profileId: string | null;
  /** Optional catalog override; null/undefined → profile default. */
  catalog?: string | null;
  /** Optional schema override; null/undefined → profile default schema. */
  schema?: string | null;
};

type BindingListener = () => void;

function emptyBinding(): EditorConnectionBinding {
  return { profileId: null, catalog: null, schema: null };
}

function defaultBindingFromProfile(
  profileId: string | null,
): EditorConnectionBinding {
  if (!profileId) {
    return emptyBinding();
  }
  const profile = ConnectionService.getProfile(profileId);
  if (!profile) {
    return emptyBinding();
  }
  return {
    profileId,
    catalog: profile.catalog.trim() || null,
    schema: effectiveDefaultSchema(profile) || null,
  };
}

/**
 * Per-editor-tab connection binding (MC-B). Sidecar map — does not mutate EditorTab.
 * Bindings survive disconnect; Run routing is MC-D.
 */
class EditorConnectionBindingServiceImpl {
  private readonly bindings = new Map<string, EditorConnectionBinding>();
  private explorerProfileId: string | null = null;
  private lastActiveTabId: string | null = null;
  private lastFocusedSurface: "editor" | "explorer" | null = null;
  private readonly listeners = new Set<BindingListener>();
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    document.addEventListener("pointerdown", this.recordFocusedSurface, true);
    document.addEventListener("focusin", this.recordFocusedSurface, true);
    document.addEventListener("keydown", this.recordFocusedSurface, true);

    EditorService.onDidChange(() => {
      this.syncWithEditorTabs();
    });
    this.syncWithEditorTabs();
  }

  setExplorerProfileId(profileId: string | null): void {
    this.explorerProfileId = profileId;
  }

  /** Capture the connection selected in the UI surface that initiated the command. */
  resolveNewEditorBinding(
    fromEditor?: boolean,
    activeOverride?: EditorConnectionBinding,
  ): EditorConnectionBinding {
    const active = activeOverride ?? this.getActiveBinding();
    const selected = defaultBindingFromProfile(this.explorerProfileId);
    const preferEditor = fromEditor ?? this.lastFocusedSurface === "editor";
    const candidates = preferEditor ? [active, selected] : [selected, active];
    return candidates.find((binding) =>
      binding.profileId && ConnectionService.getProfile(binding.profileId),
    ) ?? emptyBinding();
  }

  getBinding(tabId: string): EditorConnectionBinding {
    return this.bindings.get(tabId) ?? emptyBinding();
  }

  getActiveBinding(): EditorConnectionBinding {
    const active = EditorService.getActiveTab();
    if (!active) return emptyBinding();
    return this.getBinding(active.id);
  }

  setBinding(tabId: string, binding: EditorConnectionBinding): void {
    const next: EditorConnectionBinding = {
      profileId: binding.profileId,
      catalog: binding.catalog ?? null,
      schema: binding.schema ?? null,
    };
    const prev = this.bindings.get(tabId);
    if (
      prev &&
      prev.profileId === next.profileId &&
      (prev.catalog ?? null) === (next.catalog ?? null) &&
      (prev.schema ?? null) === (next.schema ?? null)
    ) {
      return;
    }
    this.bindings.set(tabId, next);
    this.fireDidChange();
  }

  /** Apply the same binding to every open SQL editor tab. */
  setBindingsForAllSqlTabs(binding: EditorConnectionBinding): void {
    const next: EditorConnectionBinding = {
      profileId: binding.profileId,
      catalog: binding.catalog ?? null,
      schema: binding.schema ?? null,
    };
    let changed = false;
    for (const tab of EditorService.getTabs()) {
      if (!isSqlLanguageId(tab.languageId)) continue;
      const prev = this.bindings.get(tab.id);
      if (
        prev &&
        prev.profileId === next.profileId &&
        (prev.catalog ?? null) === (next.catalog ?? null) &&
        (prev.schema ?? null) === (next.schema ?? null)
      ) {
        continue;
      }
      this.bindings.set(tab.id, { ...next });
      changed = true;
    }
    if (changed) {
      this.fireDidChange();
    }
  }

  /**
   * Update catalog on SQL tabs for `profileId` (JDBC session is shared).
   * Also rebinds the active SQL tab to this profile so the status bar / execute
   * path see the session database. Does not write connection profile storage.
   */
  setCatalogForProfile(profileId: string, catalog: string | null): void {
    const id = profileId.trim();
    if (!id) return;
    const nextCatalog = catalog?.trim() || null;
    const profile = ConnectionService.getProfile(id);
    const defaultSchema = profile ? effectiveDefaultSchema(profile) || null : null;
    let changed = false;

    for (const tab of EditorService.getTabs()) {
      if (!isSqlLanguageId(tab.languageId)) continue;
      const prev = this.bindings.get(tab.id) ?? emptyBinding();
      if (prev.profileId !== id) continue;
      if ((prev.catalog ?? null) === nextCatalog) continue;
      this.bindings.set(tab.id, {
        profileId: id,
        catalog: nextCatalog,
        schema: prev.schema ?? defaultSchema,
      });
      changed = true;
    }

    const active = EditorService.getActiveTab();
    if (active && isSqlLanguageId(active.languageId)) {
      const prev = this.bindings.get(active.id) ?? emptyBinding();
      const nextSchema = prev.schema ?? defaultSchema;
      if (
        prev.profileId !== id ||
        (prev.catalog ?? null) !== nextCatalog
      ) {
        this.bindings.set(active.id, {
          profileId: id,
          catalog: nextCatalog,
          schema: nextSchema,
        });
        changed = true;
      }
    }

    if (changed) {
      this.fireDidChange();
    }
  }

  /**
   * Update schema on SQL tabs for `profileId` (JDBC session is shared) — the schema-level
   * counterpart of {@link setCatalogForProfile}, for dialects that switch schema instead of
   * catalog (Oracle/PostgreSQL). Does not write connection profile storage.
   */
  setSchemaForProfile(profileId: string, schema: string | null): void {
    const id = profileId.trim();
    if (!id) return;
    const nextSchema = schema?.trim() || null;
    let changed = false;

    for (const tab of EditorService.getTabs()) {
      if (!isSqlLanguageId(tab.languageId)) continue;
      const prev = this.bindings.get(tab.id) ?? emptyBinding();
      if (prev.profileId !== id) continue;
      if ((prev.schema ?? null) === nextSchema) continue;
      this.bindings.set(tab.id, {
        profileId: id,
        catalog: prev.catalog ?? null,
        schema: nextSchema,
      });
      changed = true;
    }

    const active = EditorService.getActiveTab();
    if (active && isSqlLanguageId(active.languageId)) {
      const prev = this.bindings.get(active.id) ?? emptyBinding();
      if (
        prev.profileId !== id ||
        (prev.schema ?? null) !== nextSchema
      ) {
        this.bindings.set(active.id, {
          profileId: id,
          catalog: prev.catalog ?? null,
          schema: nextSchema,
        });
        changed = true;
      }
    }

    if (changed) {
      this.fireDidChange();
    }
  }

  /** Assign a contextual binding when missing (new SQL tabs). */
  ensureBinding(tabId: string): EditorConnectionBinding {
    const existing = this.bindings.get(tabId);
    if (existing) return existing;
    const next = this.resolveNewEditorBinding();
    this.bindings.set(tabId, next);
    this.fireDidChange();
    return next;
  }

  removeTab(tabId: string): void {
    if (!this.bindings.delete(tabId)) return;
    this.fireDidChange();
  }

  onDidChange(listener: BindingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private syncWithEditorTabs(): void {
    // Bindings are stored across all editor groups. `EditorService.getTabs()` only
    // returns tabs from the focused group, so using it here would mistake tabs in
    // other groups for closed tabs whenever focus moves between groups.
    const tabs = EditorGroupsService.getGroupIds().flatMap((groupId) =>
      EditorGroupsService.getGroup(groupId).getTabs(),
    );
    const liveIds = new Set(tabs.map((tab) => tab.id));
    const previousBinding = this.lastActiveTabId
      ? this.getBinding(this.lastActiveTabId)
      : emptyBinding();
    this.lastActiveTabId = EditorService.getActiveTab()?.id ?? null;
    let changed = false;

    for (const tabId of [...this.bindings.keys()]) {
      if (!liveIds.has(tabId)) {
        this.bindings.delete(tabId);
        changed = true;
      }
    }

    for (const tab of tabs) {
      if (!isSqlLanguageId(tab.languageId)) continue;
      if (this.bindings.has(tab.id)) continue;
      const ref = parseObjectEditorUri(tab.uri) ?? parseDdlEditorUri(tab.uri) ?? parsePlsqlEditorUri(tab.uri);
      const binding = ref
        ? (ConnectionService.getProfile(ref.profileId)
            ? { profileId: ref.profileId, catalog: ref.catalogName ?? null, schema: ref.schemaName }
            : emptyBinding())
        : this.resolveNewEditorBinding(undefined, previousBinding);
      this.bindings.set(tab.id, binding);
      changed = true;
    }

    if (changed) {
      this.fireDidChange();
    }
  }

  private readonly recordFocusedSurface = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(".monaco-editor, .editor-area, .tab-bar")
    ) {
      this.lastFocusedSurface = "editor";
    } else if (target.closest(".connections-explorer")) {
      this.lastFocusedSurface = "explorer";
    }
  };

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        // One subscriber's stale-state exception (e.g. a component still holding a
        // just-replaced editor group id right after session restore) must not abort
        // whatever caller triggered this notification — see startEditorSessionSync's
        // restored-binding loop, which depends on every iteration running.
        console.error("[EditorConnectionBindingService] onDidChange listener failed", error);
      }
    }
  }
}

export const EditorConnectionBindingService =
  new EditorConnectionBindingServiceImpl();
