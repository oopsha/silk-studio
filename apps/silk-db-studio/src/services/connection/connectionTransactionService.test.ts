import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rollback: vi.fn(), confirm: vi.fn(), notify: vi.fn(),
  refresh: vi.fn(), invalidate: vi.fn(), page: vi.fn() }));
vi.mock("@silk-studio/workbench/platform/i18n/activeLocale.ts", () => ({ tKey: (key: string) => key }));
vi.mock("@silk-studio/workbench/services/notifications/appNotificationService.ts", () => ({
  AppNotificationService: { show: mocks.notify },
}));
vi.mock("../formatErrorMessage", () => ({ formatErrorMessage: (error: Error) => error.message }));
vi.mock("../ui/confirmDialogService", () => ({ ConfirmDialogService: { confirm: mocks.confirm } }));
vi.mock("./connectionBridge", () => ({ bridgeCommit: vi.fn(), bridgeRollback: mocks.rollback }));
vi.mock("./connectionService", () => ({ ConnectionService: { onDidChange: vi.fn(),
  getState: () => ({ connectedProfileIds: ["db"] }), getProfile: () => ({ name: "db" }) } }));
vi.mock("./pendingDdlSaveService", () => ({ discardPendingDdlSaves: vi.fn(), resolvePendingDdlSaves: vi.fn() }));
vi.mock("../query/queryExecutionService", () => ({ QueryExecutionService: {
  refreshResultTabsForConnection: mocks.refresh, invalidateRunningQueriesForConnection: mocks.invalidate,
} }));
vi.mock("../query/queryResultPaging", () => ({ fetchQueryResultPage: mocks.page }));

import { rollbackConnection, ConnectionTransactionService } from "./connectionTransactionService";
import { QueryResultQueryService as queries } from "../query/queryResultQueryService";
import { QueryResultDirtyService as rows } from "../query/queryResultDirtyService";
import { gridUiStateByTabId, removeResultViewStates } from "../query/queryResultViewStateService";
const id = "rollback-view";
const payload = (value: string) => ({ kind: "resultSet" as const, columns: ["value"], rows: [[value]],
  rowCount: 1, updateCount: null, message: "ok" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
  mocks.rollback.mockResolvedValue({ rolledBack: true });
  mocks.refresh.mockImplementation(() => queries.reload(id));
  mocks.page.mockResolvedValue(payload("before"));
  rows.initTab(id, ["value"], [["saved-but-uncommitted"]]);
  queries.register(id, { connectionId: "db", sql: "select value from items", columns: ["value"], paged: true,
    prepare: async () => {}, fetchInitial: async () => payload("before") }, 1);
  gridUiStateByTabId.set(id, { filterModel: { value: { type: "contains", filter: "0003" } }, sortState: [] });
  ConnectionTransactionService.markDirty("db");
});
afterEach(() => {
  queries.removeTabs([id]); rows.removeTab(id); removeResultViewStates([id]);
  ConnectionTransactionService.clear("db");
});

describe("rollback and result refresh", () => {
  it("blocks old reads before rollback and reloads the same filter after DB rollback", async () => {
    mocks.rollback.mockImplementation(async () => {
      expect(queries.isBusy(id)).toBe(true);
      expect(mocks.invalidate).toHaveBeenCalledWith("db");
      return { rolledBack: true };
    });
    await rollbackConnection("db");
    expect(ConnectionTransactionService.isDirty("db")).toBe(false);
    expect(rows.getDisplayRows(id)[0].value).toBe("before");
    expect(mocks.page.mock.calls[0][5].filters[0].conditions[0].value).toBe("0003");
    expect(queries.isBusy(id)).toBe(false);
  });

  it("does not change data or transactions when confirmation is cancelled", async () => {
    mocks.confirm.mockResolvedValue(false);
    await rollbackConnection("db");
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(ConnectionTransactionService.isDirty("db")).toBe(true);
  });

  it("keeps a failed DB rollback pending and unblocks queries", async () => {
    mocks.rollback.mockRejectedValueOnce(new Error("DB failure"));
    await rollbackConnection("db");
    expect(ConnectionTransactionService.isDirty("db")).toBe(true);
    expect(queries.isBusy(id)).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledWith("app.transaction.rollbackFailed", "error");
  });

  it("distinguishes refresh failure after a successful rollback", async () => {
    mocks.refresh.mockRejectedValueOnce(new Error("SELECT failed"));
    await rollbackConnection("db");
    expect(ConnectionTransactionService.isDirty("db")).toBe(false);
    expect(mocks.notify).toHaveBeenCalledWith("app.transaction.rollbackRefreshFailed", "error");
  });

  it("refreshes stale views even when JDBC reports no pending transaction", async () => {
    mocks.rollback.mockResolvedValueOnce({ rolledBack: false });
    await rollbackConnection("db");
    expect(mocks.refresh).toHaveBeenCalledWith("db");
    expect(rows.getDisplayRows(id)[0].value).toBe("before");
  });

  it("keeps transaction state after closing a data tab and discloses unsaved UI edits", async () => {
    rows.setCell(id, 0, "value", "unsaved");
    mocks.confirm.mockResolvedValue(false);
    await rollbackConnection("db");
    expect(mocks.confirm.mock.calls[0][0].message).toContain("app.transaction.rollbackUnsavedEdits");
    queries.removeTabs([id]); rows.removeTab(id);
    expect(ConnectionTransactionService.isDirty("db")).toBe(true);
  });
});
