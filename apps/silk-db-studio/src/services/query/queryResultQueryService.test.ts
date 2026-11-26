import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResultPayload } from "@silk-studio/db-protocol";
vi.mock("./queryResultPaging", () => ({ fetchQueryResultPage: vi.fn() }));
import { QueryResultQueryServiceImpl } from "./queryResultQueryService";
import { QueryResultDirtyService as rows } from "./queryResultDirtyService";
import { gridUiStateByTabId, gridViewStateByTabId, removeResultViewStates, type GridUiState } from "./queryResultViewStateService";

const id = "requests-test";
const columns = ["id", "value"];
const payload = (value: string, count = 1): QueryResultPayload => ({
  kind: "resultSet", columns, rows: Array.from({ length: count }, (_, index) => [String(index), value]),
  rowCount: count, updateCount: null, message: "ok",
});
const filter = (value: string): GridUiState => ({ filterModel: { value: { type: "equals", filter: value } },
  sortState: [{ colId: "id", sort: "desc", sortIndex: 0 }] });
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let page: ReturnType<typeof vi.fn<typeof import("./queryResultPaging").fetchQueryResultPage>>;
let service: QueryResultQueryServiceImpl;
let initial: ReturnType<typeof vi.fn<() => Promise<QueryResultPayload>>>;
beforeEach(() => {
  page = vi.fn(); initial = vi.fn().mockResolvedValue(payload("initial-refreshed"));
  service = new QueryResultQueryServiceImpl(page);
  rows.initTab(id, columns, payload("old", 100).rows);
  service.register(id, { connectionId: "db", sql: "select * from items where company = ?", columns,
    binds: ["1160"], paged: true, prepare: async () => {}, fetchInitial: initial }, 100);
});
afterEach(() => {
  service.removeTabs([id]); rows.removeTab(id); removeResultViewStates([id]);
});

describe("result query conditions and request generations", () => {
  it("reloads the shown page with the same bind, filter and sort and preserves the viewport", async () => {
    gridUiStateByTabId.set(id, filter("0003"));
    gridViewStateByTabId.set(id, { nextOffset: 200, hasMore: true, firstVisibleRow: 30, lastVisibleRow: 50,
      pageIndex: 1, pageSize: 100 });
    page.mockResolvedValueOnce(payload("second", 100));
    await service.reload(id);
    expect(page).toHaveBeenCalledTimes(1);
    expect(page.mock.calls[0][3]).toBe(100);
    expect(page.mock.calls[0][4]).toBe(100);
    expect(page.mock.calls[0][5]).toMatchObject({ binds: ["1160"],
      filters: [{ column: "value", conditions: [{ type: "equals", value: "0003" }] }],
      sort: [{ column: "id", direction: "desc" }] });
    expect(gridViewStateByTabId.get(id)).toMatchObject({ firstVisibleRow: 30, pageIndex: 1, nextOffset: 200 });
    const shown = rows.getDisplayRows(id);
    expect(shown).toHaveLength(100);
    expect(shown[0].__rowIndex).toBe("100");
  });

  it("starts at the first row if the old viewport no longer exists", async () => {
    gridViewStateByTabId.set(id, { nextOffset: 200, hasMore: true, firstVisibleRow: 130, lastVisibleRow: 150 });
    page.mockResolvedValue(payload("short", 79));
    await service.reload(id, filter("0003"));
    expect(gridViewStateByTabId.get(id)).toMatchObject({ firstVisibleRow: 0, nextOffset: 79, hasMore: false });
    expect(service.isPaged(id)).toBe(true); // A short filtered result does not disable future server filtering.
  });

  it("moves to another page with the committed query", async () => {
    page.mockResolvedValueOnce(payload("filtered", 100)).mockResolvedValueOnce(payload("third"));
    await service.reload(id, filter("0003"));
    await service.goToPage(id, 2);
    expect(page.mock.calls[1][3]).toBe(200);
    expect(page.mock.calls[1][5]).toEqual(page.mock.calls[0][5]);
    const shown = rows.getDisplayRows(id);
    expect(shown).toHaveLength(1);
    expect(shown[0].__rowIndex).toBe("200");
    expect(gridViewStateByTabId.get(id)).toMatchObject({ pageIndex: 2, nextOffset: 201, hasMore: false });
  });

  it("scroll mode reloads every loaded block and appends without clearing local changes", async () => {
    service.register(id, { connectionId: "db", sql: "select * from items where company = ?", columns,
      binds: ["1160"], paged: true, pagingMode: "scroll", prepare: async () => {}, fetchInitial: initial }, 100);
    gridViewStateByTabId.set(id, { nextOffset: 200, hasMore: true, firstVisibleRow: 130, lastVisibleRow: 150 });
    page.mockResolvedValueOnce(payload("first", 100)).mockResolvedValueOnce(payload("second", 100))
      .mockResolvedValueOnce(payload("next"));
    await service.reload(id);
    expect(page.mock.calls.map((call) => call[3])).toEqual([0, 100]);
    expect(gridViewStateByTabId.get(id)?.firstVisibleRow).toBe(130);
    expect(rows.getDisplayRows(id)).toHaveLength(200);
    rows.setCell(id, 0, "value", "unsaved");
    await service.append(id);
    expect(page.mock.calls[2][3]).toBe(200);
    expect(rows.getDisplayRows(id)).toHaveLength(201);
    expect(rows.getDisplayRows(id)[0].value).toBe("unsaved");
  });

  it("scroll mode appends blocks of the initial fetch size and can be cancelled", async () => {
    service.register(id, { connectionId: "db", sql: "select * from items", columns,
      paged: true, pagingMode: "scroll", prepare: async () => {}, fetchInitial: initial }, 100);
    const pending = deferred<QueryResultPayload>();
    page.mockReturnValueOnce(pending.promise);
    const appending = service.append(id);
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    expect(page.mock.calls[0][4]).toBe(100);
    expect(service.isAppending(id)).toBe(true);
    expect(service.cancelAppend(id)).toBe("db");
    expect(service.isAppending(id)).toBe(false);
    pending.resolve(payload("late", 100));
    await appending;
    expect(rows.getDisplayRows(id)).toHaveLength(100);
    expect(gridViewStateByTabId.get(id)?.nextOffset).toBe(100);
  });

  it("page mode does not append on scroll", async () => {
    await service.append(id);
    expect(page).not.toHaveBeenCalled();
  });

  it("falls back to the first page when the requested page is empty", async () => {
    page.mockResolvedValueOnce(payload("none", 0)).mockResolvedValueOnce(payload("first", 100));
    await service.goToPage(id, 5);
    expect(page.mock.calls.map((call) => call[3])).toEqual([500, 0]);
    expect(gridViewStateByTabId.get(id)).toMatchObject({ pageIndex: 0, hasMore: true });
  });

  it("keeps the latest filter when an older filter completes later", async () => {
    const old = deferred<QueryResultPayload>();
    page.mockReturnValueOnce(old.promise).mockResolvedValueOnce(payload("latest"));
    const first = service.reload(id, filter("old"));
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    await service.reload(id, filter("latest"));
    old.resolve(payload("stale"));
    expect(await first).toBeNull();
    expect(rows.getDisplayRows(id)[0].value).toBe("latest");
    expect(gridUiStateByTabId.get(id)).toEqual(filter("latest"));
    expect(service.isBusy(id)).toBe(false);
  });

  it("discards a page from before rollback even when it arrives after the refreshed rows", async () => {
    const old = deferred<QueryResultPayload>();
    page.mockReturnValueOnce(old.promise).mockResolvedValueOnce(payload("rolled-back"));
    const moving = service.goToPage(id, 1);
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    const resume = service.pauseConnection("db");
    expect(service.isBusy(id)).toBe(true);
    expect(await service.goToPage(id, 1)).toBeNull();
    expect(await service.reload(id)).toBeNull();
    expect(page).toHaveBeenCalledTimes(1);
    resume();
    await service.reload(id);
    old.resolve(payload("uncommitted"));
    expect(await moving).toBeNull();
    expect(rows.getDisplayRows(id).map((row) => row.value)).toEqual(["rolled-back"]);
    expect(gridViewStateByTabId.get(id)).toMatchObject({ nextOffset: 1, pageIndex: 0 });
  });

  it("does not resurrect a closed result from an outstanding request", async () => {
    const pending = deferred<QueryResultPayload>();
    page.mockReturnValue(pending.promise);
    const loading = service.reload(id);
    await vi.waitFor(() => expect(page).toHaveBeenCalled());
    service.removeTabs([id]); rows.removeTab(id); removeResultViewStates([id]);
    pending.resolve(payload("stale"));
    expect(await loading).toBeNull();
    expect(rows.hasTab(id)).toBe(false);
    expect(gridUiStateByTabId.has(id)).toBe(false);
  });

  it("ignores an obsolete failure and restores committed conditions on a current failure", async () => {
    const old = deferred<QueryResultPayload>();
    page.mockReturnValueOnce(old.promise).mockResolvedValueOnce(payload("latest"));
    const loading = service.reload(id, filter("old"));
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    await service.reload(id, filter("latest"));
    old.reject(new Error("old failure"));
    expect(await loading).toBeNull();
    page.mockRejectedValueOnce(new Error("current failure"));
    await expect(service.reload(id, filter("failed"))).rejects.toThrow("current failure");
    expect(gridUiStateByTabId.get(id)).toEqual(filter("latest"));
    expect(rows.getDisplayRows(id)[0].value).toBe("latest");
  });

  it("does not overwrite edits made while a reload was outstanding", async () => {
    const pending = deferred<QueryResultPayload>();
    page.mockReturnValue(pending.promise);
    const loading = service.reload(id);
    await vi.waitFor(() => expect(page).toHaveBeenCalled());
    rows.setCell(id, 0, "value", "new-edit");
    pending.resolve(payload("server"));
    await expect(loading).rejects.toThrow("Grid edits changed");
    expect(rows.getDisplayRows(id)[0].value).toBe("new-edit");
  });

  it("keeps local filter state on a non-paged result refresh", async () => {
    service.register(id, { connectionId: "db", sql: "select * from items", columns,
      paged: false, prepare: async () => {}, fetchInitial: initial }, 100);
    gridUiStateByTabId.set(id, filter("0003"));
    await service.reload(id);
    expect(page).not.toHaveBeenCalled();
    expect(initial).toHaveBeenCalledOnce();
    expect(gridUiStateByTabId.get(id)).toEqual(filter("0003"));
  });

  it("enables paging if a previously small result grows past the fetch limit", async () => {
    initial.mockResolvedValueOnce({ ...payload("grown", 200), truncated: true });
    service.register(id, { connectionId: "db", sql: "select * from items", columns,
      paged: false, prepare: async () => {}, fetchInitial: initial }, 1);
    await service.reload(id);
    expect(service.isPaged(id)).toBe(true);
    expect(gridViewStateByTabId.get(id)).toMatchObject({ nextOffset: 200, hasMore: true });
  });
});
