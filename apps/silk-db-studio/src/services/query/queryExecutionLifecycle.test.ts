import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tabs: [] as Array<{ id: string; uri: string }>,
  active: "sql",
  changed: (() => {}) as () => void,
  desktop: false,
  ensureConnection: vi.fn(),
  invoke: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => state.desktop, invoke: state.invoke }));
vi.mock("@silk-studio/editor/services/editor/editorServiceFacade.ts", () => ({
  EditorService: { getActiveTabId: () => state.active },
}));
vi.mock("@silk-studio/editor/services/editor/editorGroupsService.ts", () => ({
  EditorGroupsService: {
    getGroupIds: () => ["group"], getFocusedGroupId: () => "group",
    getGroup: () => ({ getTabs: () => state.tabs, getActiveTabId: () => state.active }),
    onDidChangeAnyGroup: (fn: () => void) => { state.changed = fn; },
    onDidRemoveGroup: vi.fn(),
  },
}));
vi.mock("@silk-studio/workbench/platform/configuration/configurationService.ts", () => ({
  ConfigurationService: { getValue: (key: string) => key === "sql.parameters.namedPrefix" ? ":" : false },
}));
vi.mock("@silk-studio/workbench/platform/i18n/activeLocale.ts", () => ({ tKey: (key: string) => key }));
vi.mock("@silk-studio/workbench/services/diagnostics/appLogService.ts", () => ({ AppLogService: {} }));
vi.mock("../formatErrorMessage", () => ({ formatErrorMessage: String, reportError: vi.fn() }));
vi.mock("../connection/connectionBridge", () => ({ bridgeRollback: vi.fn() }));
vi.mock("../connection/jdbcInvoke", () => ({ invokeJdbcCommand: state.query }));
vi.mock("../connection/connectionService", () => ({ ConnectionService: { getProfile: () => ({ name: "db" }) } }));
vi.mock("../connection/connectionTransactionService", () => ({ ConnectionTransactionService: {} }));
vi.mock("../connection/editorConnectionBindingService", () => ({
  EditorConnectionBindingService: { getActiveBinding: () => ({ profileId: "db" }) },
}));
vi.mock("../sql/sqlDialect", () => ({ driverAutoCommitsDdl: () => false, resolveActiveDriverId: () => "sqlserver" }));
vi.mock("./queryHistoryService", () => ({ QueryHistoryService: { record: vi.fn() } }));
vi.mock("./sqlErrorMarkers", () => ({ clearSqlErrorMarkers: vi.fn(), applySqlErrorMarkers: vi.fn() }));
vi.mock("./sqlParameterDialogService", () => ({ SqlParameterDialogService: {} }));
vi.mock("./resolveExecutionConnection", () => ({
  resolveExecutionConnectionId: () => "db", ensureExecutionConnection: state.ensureConnection,
}));

import { QueryExecutionService } from "./queryExecutionService";
import { QueryResultDirtyService } from "./queryResultDirtyService";
import { gridUiStateByTabId, gridViewStateByTabId } from "./queryResultViewStateService";
import { getObjectEditorSection, setObjectEditorSection } from "../connection/objectEditorSectionService";
import { TableDataImportService } from "./tableDataImportService";

QueryExecutionService.start();

describe("editor-owned table data lifecycle", () => {
  beforeEach(() => {
    state.tabs = [];
    state.active = "sql";
    state.changed();
    state.desktop = false;
    state.invoke.mockReset().mockResolvedValue({});
    state.ensureConnection.mockReset();
    state.query.mockReset();
    state.tabs = [{ id: "sql", uri: "untitled:sql" }, { id: "table", uri: "silk://object/db/dbo/table/items" }];
    state.changed();
  });

  it("keeps embedded results out of the SQL panel and retains them on tab switches", async () => {
    await QueryExecutionService.execute("SELECT * FROM dbo.items", { ownerId: "table", connectionId: "db" });
    const result = QueryExecutionService.getSessionState("table").tabs[0];
    expect(result).toBeDefined();
    expect(QueryExecutionService.getViewOwnerId("group")).toBe("sql");
    state.active = "table"; state.changed();
    state.active = "sql"; state.changed();
    expect(QueryExecutionService.getSessionState("table").tabs[0]).toBe(result);
    expect(QueryExecutionService.getState("group").tabs).toHaveLength(0);
  });

  it("disposes results, filters, paging, section and queued import when the editor closes", async () => {
    await QueryExecutionService.execute("SELECT * FROM dbo.items", { ownerId: "table" });
    const resultId = QueryExecutionService.getSessionState("table").tabs[0].id;
    QueryResultDirtyService.initTab(resultId, ["id"], [["1"]]);
    gridUiStateByTabId.set(resultId, { filterModel: { id: "0003" }, sortState: [] });
    gridViewStateByTabId.set(resultId, { nextOffset: 200, hasMore: true, firstVisibleRow: 3, lastVisibleRow: 20 });
    setObjectEditorSection("table", "data");
    TableDataImportService.request("table", {} as File);
    state.tabs = state.tabs.filter((tab) => tab.id !== "table"); state.changed();
    expect(QueryExecutionService.getSessionState("table").tabs).toHaveLength(0);
    expect(QueryResultDirtyService.hasTab(resultId)).toBe(false);
    expect(gridUiStateByTabId.has(resultId)).toBe(false);
    expect(gridViewStateByTabId.has(resultId)).toBe(false);
    expect(getObjectEditorSection("table")).toBeUndefined();
    expect(TableDataImportService.getFile("table")).toBeNull();
    state.tabs.push({ id: "new-table", uri: "silk://object/db/dbo/table/items" }); state.changed();
    expect(QueryExecutionService.getSessionState("new-table").tabs).toHaveLength(0);
  });

  it("does not recreate a closed session when connection setup finishes late", async () => {
    state.desktop = true;
    let complete!: () => void;
    state.ensureConnection.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    const execution = QueryExecutionService.execute("SELECT * FROM dbo.items", { ownerId: "table" });
    await vi.waitFor(() => expect(state.ensureConnection).toHaveBeenCalled());
    state.tabs = state.tabs.filter((tab) => tab.id !== "table"); state.changed();
    complete();
    await execution;
    expect(QueryExecutionService.getSessionState("table").tabs).toHaveLength(0);
    expect(QueryExecutionService.getSessionState("table").status).toBe("idle");
  });

  it("publishes initial and refreshed server rows through the same baseline", async () => {
    state.desktop = true;
    const payload = (value: string) => ({ kind: "resultSet", columns: ["id", "value"],
      rows: [["1", value]], rowCount: 1, updateCount: null, message: "ok" });
    state.query.mockResolvedValueOnce(payload("before"));
    await QueryExecutionService.execute("SELECT * FROM dbo.items", { ownerId: "table", connectionId: "db" });
    const resultId = QueryExecutionService.getSessionState("table").tabs[0].id;
    expect(QueryResultDirtyService.getDisplayRows(resultId)[0].value).toBe("before");
    QueryResultDirtyService.setCell(resultId, 0, "value", "saved");
    state.query.mockResolvedValueOnce(payload("saved"));
    await QueryExecutionService.refreshTabResult(resultId);
    expect(QueryResultDirtyService.hasPendingChanges(resultId)).toBe(false);
    expect(QueryResultDirtyService.getDisplayRows(resultId)[0].value).toBe("saved");
    state.query.mockResolvedValueOnce(payload("before"));
    await QueryExecutionService.refreshTabResult(resultId);
    expect(QueryResultDirtyService.getDisplayRows(resultId)[0].value).toBe("before");
    expect(QueryResultDirtyService.getOriginalRows(resultId)[0].value).toBe("before");
  });

  it("rejects an initial SELECT result started before a transaction outcome", async () => {
    state.desktop = true;
    let finish!: (payload: unknown) => void;
    state.query.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const execution = QueryExecutionService.execute("SELECT * FROM dbo.items", { ownerId: "table", connectionId: "db" });
    await vi.waitFor(() => expect(state.query).toHaveBeenCalled());
    QueryExecutionService.invalidateRunningQueriesForConnection("db");
    finish({ kind: "resultSet", columns: ["id"], rows: [["stale"]], rowCount: 1, updateCount: null, message: "ok" });
    await execution;
    expect(QueryExecutionService.getSessionState("table").tabs).toHaveLength(0);
    expect(QueryExecutionService.getSessionState("table").status).toBe("cancelled");
  });

  it("marks a refresh failure as an error instead of silently showing old data", async () => {
    state.desktop = true;
    state.query.mockResolvedValueOnce({ kind: "resultSet", columns: ["id"], rows: [["old"]], rowCount: 1, updateCount: null, message: "ok" });
    await QueryExecutionService.execute("SELECT * FROM dbo.items", { ownerId: "table", connectionId: "db" });
    const resultId = QueryExecutionService.getSessionState("table").tabs[0].id;
    state.query.mockRejectedValueOnce(new Error("SELECT failed"));
    await expect(QueryExecutionService.refreshTabResult(resultId)).rejects.toThrow("SELECT failed");
    expect(QueryExecutionService.getSessionState("table").status).toBe("error");
  });
});
