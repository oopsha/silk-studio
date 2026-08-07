import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadEditorSessionSnapshot,
  saveEditorSessionSnapshot,
} from "./editorSessionStorage";
import type { EditorSessionSnapshotV2 } from "./editorSessionTypes";

const STORAGE_KEY = "silk-editor.session.v1";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("editorSessionStorage", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = createMemoryStorage();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("round-trips a v2 snapshot as-is", async () => {
    const snapshot: EditorSessionSnapshotV2 = {
      version: 2,
      savedAt: 12345,
      layout: {
        type: "split",
        id: "split-1",
        direction: "row",
        children: [
          { type: "group", id: "group-a" },
          { type: "group", id: "group-b" },
        ],
        sizes: [0.5, 0.5],
      },
      focusedGroupId: "group-b",
      groups: [
        { groupId: "group-a", activeTabId: "tab-1", tabs: [] },
        { groupId: "group-b", activeTabId: null, tabs: [] },
      ],
    };

    await saveEditorSessionSnapshot(snapshot);
    const loaded = await loadEditorSessionSnapshot();
    expect(loaded).toEqual(snapshot);
  });

  it("migrates a v1 flat-tabs snapshot into a single-group v2 envelope with no data loss", async () => {
    const v1 = {
      version: 1,
      savedAt: 999,
      activeTabId: "tab-legacy-1",
      untitledCounter: 3,
      tabs: [
        {
          id: "tab-legacy-1",
          label: "legacy.sql",
          uri: "silk://plsql/legacy",
          languageId: "sql",
          content: "SELECT 1 FROM DUAL",
          savedContent: "SELECT 1 FROM DUAL",
          isDirty: false,
          isPreview: false,
          isPinned: true,
        },
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1));

    const loaded = await loadEditorSessionSnapshot();
    expect(loaded?.version).toBe(2);
    expect(loaded?.groups).toHaveLength(1);
    expect(loaded?.layout).toEqual({
      type: "group",
      id: loaded?.focusedGroupId,
    });
    expect(loaded?.groups[0]?.groupId).toBe(loaded?.focusedGroupId);
    expect(loaded?.groups[0]?.activeTabId).toBe("tab-legacy-1");
    expect(loaded?.groups[0]?.tabs).toEqual(v1.tabs);
  });

  it("rejects unparseable or unrecognized-version data", async () => {
    localStorage.setItem(STORAGE_KEY, "not json");
    expect(await loadEditorSessionSnapshot()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, groups: [] }));
    expect(await loadEditorSessionSnapshot()).toBeNull();
  });

  it("returns null when nothing has been saved", async () => {
    expect(await loadEditorSessionSnapshot()).toBeNull();
  });
});
