import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridApi } from "ag-grid-community";
import type { QueryResultRow } from "./queryResult";

const state = vi.hoisted(() => ({
  focused: "left",
  active: { left: "table-a", right: "table-b" } as Record<string, string>,
  writeText: vi.fn(), saveLayout: vi.fn(),
  desktop: false, saveFile: vi.fn(), writeFile: vi.fn(),
}));
vi.mock("@silk-studio/editor/services/editor/editorGroupsService.ts", () => ({
  EditorGroupsService: {
    getFocusedGroupId: () => state.focused,
    getGroupIfExists: (id: string) => ({ getActiveTabId: () => state.active[id] }),
    onDidChangeAnyGroup: () => () => {},
  },
}));
vi.mock("./queryResultColumnLayout", () => ({
  hasSavedColumnLayout: () => false, loadColumnLayout: () => null,
  saveColumnLayout: state.saveLayout, clearColumnLayout: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => state.desktop }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: state.saveFile }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: state.writeFile }));

import { QueryResultGridCommandRouter, QueryResultGridController } from "./queryResultGridService";

function grid(value: string) {
  const rows = [{ value, __rowIndex: "0" }, { value: `${value}-2`, __rowIndex: "1" }];
  const column = { getColId: () => "value", getColDef: () => ({ field: "value" }) };
  const nodes = rows.map((data) => ({ data }));
  const api = {
    isDestroyed: () => false,
    forEachNode: (fn: (node: unknown) => void) => nodes.forEach(fn),
    forEachNodeAfterFilterAndSort: (fn: (node: unknown) => void) => nodes.forEach(fn),
    isAnyFilterPresent: () => false,
    getColumnState: () => [{ colId: "value", width: 140 }],
    getAllDisplayedColumns: () => [column],
    getFocusedCell: () => ({ rowIndex: 0, column }),
    getDisplayedRowAtIndex: (index: number) => nodes[index],
    setFilterModel: vi.fn(), applyColumnState: vi.fn(), autoSizeColumns: vi.fn(),
  };
  return { api: api as unknown as GridApi<QueryResultRow>, calls: api };
}

const cleanups: Array<() => void> = [];
beforeEach(() => {
  state.focused = "left";
  state.active = { left: "table-a", right: "table-b" };
  state.writeText.mockReset().mockResolvedValue(undefined);
  state.saveLayout.mockReset();
  state.desktop = false;
  state.saveFile.mockReset().mockResolvedValue("result.csv");
  state.writeFile.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: state.writeText } });
  vi.stubGlobal("window", globalThis);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

function setup() {
  const router = new QueryResultGridCommandRouter();
  const a = new QueryResultGridController(); const b = new QueryResultGridController();
  const gridA = grid("A"); const gridB = grid("B");
  a.attach(gridA.api, ["value"], "NULL", () => {}, undefined, "profile-a");
  b.attach(gridB.api, ["value"], "NULL", () => {}, undefined, "profile-b");
  cleanups.push(router.register(a, { groupId: "left", ownerId: "table-a", eligible: true }));
  cleanups.push(router.register(b, { groupId: "right", ownerId: "table-b", eligible: true }));
  cleanups.push(() => a.detach(gridA.api), () => b.detach(gridB.api));
  return { router, a, b, gridA, gridB };
}

describe("grid-local actions and focused-group command routing", () => {
  it("routes commands by the focused group regardless of background attachments and updates", async () => {
    const { router, b, gridB } = setup();
    b.attach(gridB.api, ["value"], "NULL", () => {}, undefined, "profile-b");
    b.refreshSnapshot();
    await router.copy("selection");
    expect(state.writeText).toHaveBeenLastCalledWith("A");
    state.focused = "right";
    await router.copy("selection");
    expect(state.writeText).toHaveBeenLastCalledWith("B");
  });

  it("keeps local toolbar actions on their own grid even when another group is focused", () => {
    const { a, gridA, gridB } = setup();
    state.focused = "right";
    a.clearFiltersAndSort();
    expect(gridA.calls.setFilterModel).toHaveBeenCalledWith(null);
    expect(gridB.calls.setFilterModel).not.toHaveBeenCalled();
  });

  it("disables commands for a different editor or a hidden data section", async () => {
    const { router, a, gridA } = setup();
    state.active.left = "sql-without-result";
    expect(router.isAttached()).toBe(false);
    expect(await router.copy("all")).toBe(false);
    state.active.left = "table-a";
    const stop = router.register(a, { groupId: "left", ownerId: "table-a", eligible: false });
    expect(router.isAttached()).toBe(false);
    router.clearFiltersAndSort();
    expect(gridA.calls.setFilterModel).not.toHaveBeenCalled();
    stop();
  });

  it("preserves selection and unsaved column widths when the same API reattaches", async () => {
    const { a, gridA } = setup();
    a.setCellSelection(["value"], 0, 1);
    a.markColumnLayoutDirty();
    a.attach(gridA.api, ["value"], "NULL", () => {}, undefined, "profile-a");
    expect(a.getSnapshot().layoutDirty).toBe(true);
    a.autoSizeToContent();
    expect(gridA.calls.autoSizeColumns).not.toHaveBeenCalled();
    await a.copy("selection");
    expect(state.writeText).toHaveBeenLastCalledWith("A\nA-2");
  });

  it("saves a local layout to its actual connection, independently of focus", () => {
    const { a } = setup();
    state.focused = "right";
    a.saveColumnLayoutNow();
    expect(state.saveLayout).toHaveBeenCalledWith("profile-a", ["value"], expect.any(Array));
  });

  it("does not mix layout state and suppression timers between grids", () => {
    const { a, b } = setup();
    a.autoSizeAllColumns();
    b.markColumnLayoutDirty();
    expect(b.getSnapshot().layoutDirty).toBe(true);
    vi.runAllTimers();
    expect(b.getSnapshot().layoutDirty).toBe(true);
    expect(a.getSnapshot().layoutDirty).toBe(false);
  });

  it("unregisters a closed grid without redirecting commands to another visible group", async () => {
    const { router, a, gridA } = setup();
    const updated = vi.fn();
    router.onDidChangeSnapshot(updated);
    a.detach(gridA.api);
    expect(updated).toHaveBeenCalled();
    expect(router.isAttached()).toBe(false);
    expect(await router.copy("all")).toBe(false);
    expect(state.writeText).not.toHaveBeenCalled();
  });

  it("keeps an asynchronous export bound to the grid selected when the command started", async () => {
    state.desktop = true;
    const { router, a, gridA } = setup();
    let complete!: (rows: Array<Array<string | null>>) => void;
    a.attach(gridA.api, ["value"], "NULL", () => {},
      () => new Promise((resolve) => { complete = resolve; }), "profile-a");
    const exporting = router.exportCsv();
    state.focused = "right";
    complete([["export-from-A"]]);
    await exporting;
    expect(state.writeFile).toHaveBeenCalledWith("result.csv", expect.stringContaining("export-from-A"));
  });
});
