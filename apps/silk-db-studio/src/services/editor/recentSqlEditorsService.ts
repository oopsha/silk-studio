import { isTauri } from "@tauri-apps/api/core";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { MenuId } from "@silk-studio/workbench/platform/actions/menuId.ts";
import { MenuRegistry } from "@silk-studio/workbench/platform/actions/menuRegistry.ts";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import { ConnectionService } from "../connection/connectionService";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";
import { readTextFileAtPath } from "@silk-studio/editor/services/editor/editorFileIO.ts";
import { isSqlLanguageId, monacoLanguageIdForProfile } from "../sql/sqlDialect";

export const MAX_RECENT_SQL_EDITORS = 10;
const STORAGE_DIRECTORY = "recent-sql-editors/v1";
const STORAGE_KEY = `silk-db-studio.recent-sql-editors.v1:${import.meta.env.DEV ? "dev" : "prod"}`;
const PERSIST_DEBOUNCE_MS = 300;

export type RecentSqlEditorEntry = {
  id: string;
  tabId: string;
  uri: string;
  label: string;
  languageId: string;
  content: string;
  isDirty: boolean;
  profileId: string | null;
  catalog: string | null;
  schema: string | null;
  lastOpenedAt: number;
};

function normalizeEntry(value: unknown): RecentSqlEditorEntry | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.tabId !== "string" ||
    typeof item.uri !== "string" ||
    typeof item.label !== "string" ||
    typeof item.languageId !== "string" ||
    typeof item.content !== "string" ||
    typeof item.lastOpenedAt !== "number"
  ) {
    return null;
  }
  return {
    id: item.id,
    tabId: item.tabId,
    uri: item.uri,
    label: item.label,
    languageId: item.languageId,
    content: item.content,
    isDirty: item.isDirty === true,
    profileId: typeof item.profileId === "string" ? item.profileId : null,
    catalog: typeof item.catalog === "string" ? item.catalog : null,
    schema: typeof item.schema === "string" ? item.schema : null,
    lastOpenedAt: item.lastOpenedAt,
  };
}

function parseEntries(raw: string | null): RecentSqlEditorEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeEntry)
      .filter(
        (entry): entry is RecentSqlEditorEntry =>
          entry !== null && isRecentEligibleTab(entry),
      )
      .slice(0, MAX_RECENT_SQL_EDITORS);
  } catch {
    return [];
  }
}

function readBrowserStorage(): RecentSqlEditorEntry[] {
  try {
    return parseEntries(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

async function loadEntries(): Promise<RecentSqlEditorEntry[]> {
  if (!isTauri()) return readBrowserStorage();

  try {
    const { BaseDirectory, exists, readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = `${STORAGE_DIRECTORY}/${import.meta.env.DEV ? "dev" : "prod"}.json`;
    if (await exists(path, { baseDir: BaseDirectory.AppData })) {
      return parseEntries(await readTextFile(path, { baseDir: BaseDirectory.AppData }));
    }
  } catch (error) {
    console.warn("[recent-sql-editors] failed to read AppData history", error);
  }

  // Migrate a browser-storage copy if one exists, then persist it in AppData.
  const legacy = readBrowserStorage();
  if (legacy.length > 0) await persistEntries(legacy);
  return legacy;
}

async function persistEntries(entries: RecentSqlEditorEntry[]): Promise<void> {
  const snapshot = entries.slice(0, MAX_RECENT_SQL_EDITORS);
  if (!isTauri()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn("[recent-sql-editors] failed to persist browser history", error);
    }
    return;
  }

  try {
    const { BaseDirectory, mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
    await mkdir(STORAGE_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true });
    const path = `${STORAGE_DIRECTORY}/${import.meta.env.DEV ? "dev" : "prod"}.json`;
    await writeTextFile(path, JSON.stringify(snapshot), { baseDir: BaseDirectory.AppData });
  } catch (error) {
    console.warn("[recent-sql-editors] failed to persist AppData history", error);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Keep the running editor usable when local storage is unavailable or full.
    }
  }
}

function isRecentEligibleTab(tab: {
  uri?: string | null;
  languageId: string;
}): boolean {
  const uri = tab.uri?.trim();
  return Boolean(uri) && !uri!.startsWith("silk://") && isSqlLanguageId(tab.languageId);
}

class RecentSqlEditorsServiceImpl {
  private entries: RecentSqlEditorEntry[] = [];
  private ready = false;
  private started = false;
  private lastFocusedActiveKey = "";
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private menuDisposers: Array<() => void> = [];
  private renderedMenuSignature = "";

  start(): () => void {
    if (this.started) return () => {};
    this.started = true;
    let disposed = false;

    const sync = () => {
      if (!this.ready || disposed) return;
      this.syncOpenEditors();
      this.trackFocusedEditor();
    };
    const unsubscribe = EditorGroupsService.onDidChangeAnyGroup(sync);
    const unsubscribeBindings = EditorConnectionBindingService.onDidChange(() => {
      if (this.ready && !disposed) this.syncOpenEditors();
    });

    void loadEntries().then((entries) => {
      if (disposed) return;
      this.entries = entries;
      this.ready = true;
      ContextKeyService.set("hasNoRecentSqlEditors", this.entries.length === 0);
      this.syncMenu();
      sync();
    });

    return () => {
      disposed = true;
      this.started = false;
      unsubscribe();
      unsubscribeBindings();
      if (this.persistTimer !== null) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
        this.persistNow();
      }
    };
  }

  getEntry(index: number): RecentSqlEditorEntry | undefined {
    return this.entries[index];
  }

  remove(index: number): void {
    if (index < 0 || index >= this.entries.length) return;
    this.entries.splice(index, 1);
    ContextKeyService.set("hasNoRecentSqlEditors", this.entries.length === 0);
    this.changed();
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    ContextKeyService.set("hasNoRecentSqlEditors", true);
    this.changed();
  }

  async open(index: number): Promise<void> {
    const entry = this.entries[index];
    if (!entry) return;

    const existingGroupId = EditorGroupsService.getGroupIdForTab(entry.tabId);
    if (existingGroupId) {
      EditorGroupsService.setFocusedGroup(existingGroupId);
      EditorGroupsService.getGroup(existingGroupId).setActiveTab(entry.tabId);
      this.entries.splice(index, 1);
      entry.lastOpenedAt = Date.now();
      this.entries.unshift(entry);
      this.changed();
      return;
    }

    await ConnectionService.initialize();
    const profile = entry.profileId
      ? ConnectionService.getProfile(entry.profileId)
      : undefined;
    let content = entry.content;
    if (!entry.isDirty && !entry.uri.startsWith("silk://")) {
      try {
        content = await readTextFileAtPath(entry.uri);
      } catch {
        // A missing file still opens from the last local buffer snapshot.
      }
    }

    const tabId = EditorService.openEditor({
      uri: entry.uri,
      label: entry.label,
      languageId: profile
        ? monacoLanguageIdForProfile(profile.id)
        : "sql",
      content,
      preview: false,
    });
    EditorConnectionBindingService.setBinding(
      tabId,
      profile
        ? { profileId: profile.id, catalog: entry.catalog, schema: entry.schema }
        : { profileId: null, catalog: null, schema: null },
    );
    if (entry.isDirty) EditorService.setTabDirtyOverride(tabId, true);

    entry.tabId = tabId;
    entry.content = content;
    entry.profileId = profile?.id ?? null;
    if (!profile) {
      entry.catalog = null;
      entry.schema = null;
    }
    entry.lastOpenedAt = Date.now();
    this.entries.splice(index, 1);
    this.entries.unshift(entry);
    this.changed();
  }

  private syncOpenEditors(): void {
    let changed = false;
    for (const groupId of EditorGroupsService.getGroupIds()) {
      const group = EditorGroupsService.getGroup(groupId);
      for (const tab of group.getTabs()) {
        if (!isRecentEligibleTab(tab)) continue;
        const entry = this.entries.find((item) => item.tabId === tab.id);
        if (!entry) continue;
        const binding = EditorConnectionBindingService.getBinding(tab.id);
        const nextUri = tab.uri && !tab.uri.startsWith("silk://")
          ? tab.uri
          : entry.uri;
        if (
          entry.label === tab.label &&
          entry.uri === nextUri &&
          entry.languageId === tab.languageId &&
          entry.content === tab.content &&
          entry.isDirty === tab.isDirty &&
          entry.profileId === binding.profileId &&
          entry.catalog === (binding.catalog ?? null) &&
          entry.schema === (binding.schema ?? null)
        ) {
          continue;
        }
        Object.assign(entry, {
          label: tab.label,
          uri: nextUri,
          languageId: tab.languageId,
          content: tab.content,
          isDirty: tab.isDirty,
          profileId: binding.profileId,
          catalog: binding.catalog ?? null,
          schema: binding.schema ?? null,
        });
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  private trackFocusedEditor(): void {
    const groupId = EditorGroupsService.getFocusedGroupId();
    const tab = EditorGroupsService.getFocusedGroup().getActiveTab();
    const key = `${groupId}:${tab?.id ?? ""}:${tab?.uri ?? ""}`;
    if (key === this.lastFocusedActiveKey) return;
    this.lastFocusedActiveKey = key;
    if (!tab || !isRecentEligibleTab(tab)) return;

    const binding = EditorConnectionBindingService.getBinding(tab.id);
    let entry = this.entries.find((item) => item.tabId === tab.id);
    if (!entry && tab.uri && !tab.uri.startsWith("silk://")) {
      entry = this.entries.find((item) => item.uri === tab.uri);
    }
    if (!entry) {
      const id = crypto.randomUUID();
      entry = {
        id,
        tabId: tab.id,
        uri: tab.uri && !tab.uri.startsWith("silk://")
          ? tab.uri
          : `silk://recent-sql/${id}`,
        label: tab.label,
        languageId: tab.languageId,
        content: tab.content,
        isDirty: tab.isDirty,
        profileId: binding.profileId,
        catalog: binding.catalog ?? null,
        schema: binding.schema ?? null,
        lastOpenedAt: Date.now(),
      };
    } else {
      Object.assign(entry, {
        tabId: tab.id,
        label: tab.label,
        languageId: tab.languageId,
        content: tab.content,
        isDirty: tab.isDirty,
        profileId: binding.profileId,
        catalog: binding.catalog ?? null,
        schema: binding.schema ?? null,
        lastOpenedAt: Date.now(),
      });
      this.entries = this.entries.filter((item) => item.id !== entry!.id);
    }

    this.entries.unshift(entry);
    this.entries = this.entries.slice(0, MAX_RECENT_SQL_EDITORS);
    this.changed();
  }

  private changed(): void {
    ContextKeyService.set("hasNoRecentSqlEditors", this.entries.length === 0);
    this.syncMenu();
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  private persistNow(): void {
    const snapshot = this.entries.map((entry) => ({ ...entry }));
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => persistEntries(snapshot));
  }

  private syncMenu(): void {
    const signature = this.entries.map((entry) => `${entry.id}:${entry.label}`).join("|");
    if (signature === this.renderedMenuSignature) return;
    this.renderedMenuSignature = signature;
    for (const dispose of this.menuDisposers) dispose();
    this.menuDisposers = [];

    if (this.entries.length === 0) {
      return;
    }

    this.entries.forEach((entry, index) => {
      this.menuDisposers.push(MenuRegistry.appendMenuItem(MenuId.MenubarRecentSqlEditorsMenu, {
        command: {
          id: `silk.recentSql.open.${index}`,
          title: entry.label,
          secondaryAction: {
            id: `silk.recentSql.remove.${index}`,
            title: "Remove from Recent Items",
          },
        },
        group: "1_recent",
        order: index + 1,
      }));
    });
    this.menuDisposers.push(MenuRegistry.appendMenuItem(MenuId.MenubarRecentSqlEditorsMenu, {
      command: {
        id: "silk.recentSql.clear",
        title: "Clear Recently Opened SQL Editors",
      },
      group: "2_clear",
      order: MAX_RECENT_SQL_EDITORS + 1,
    }));
  }
}

export const RecentSqlEditorsService = new RecentSqlEditorsServiceImpl();
