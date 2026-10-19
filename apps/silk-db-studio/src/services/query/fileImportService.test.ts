import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), markDirty: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => false }));
vi.mock("@silk-studio/workbench/platform/configuration/configurationService.ts", () => ({
  ConfigurationService: { getValue: (key: string) => key === "database.queryTimeoutSec" ? 30 : false },
}));
vi.mock("../connection/connectionTransactionService", () => ({ ConnectionTransactionService: { markDirty: mocks.markDirty } }));
import { executeFileImport, type ImportTarget } from "./fileImportService";
import type { FileImportPlan } from "./fileImportPlan";

const target: ImportTarget = { eligible: true, connectionId: "db", driverId: "sqlserver", catalog: "SHM", schema: "dbo", table: "items", primaryKeys: [], columns: [] };
const plan: FileImportPlan = { columns: [
  { name: "amount", sourceIndex: 1, empty: { kind: "value", value: "0" } },
  { name: "note", sourceIndex: 0, empty: { kind: "null" } },
], rows: [["", "1234.560"], ["text", ""]], firstFileRow: 2, clearExisting: true };

describe("direct JDBC file import", () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.markDirty.mockReset(); });
  it("sends a single parameterized request with mapped values and tracks manual commit", async () => {
    mocks.invoke.mockResolvedValue({ completed: 2, pendingCommit: true });
    const progress = vi.fn();
    await executeFileImport(target, plan, new AbortController().signal, progress);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    const [command, args] = mocks.invoke.mock.calls[0];
    expect(command).toBe("query_import_rows");
    expect(args.params).toMatchObject({ tableSql: "[SHM].[dbo].[items]", columnSql: "[amount],[note]", columns: ["amount", "note"], rows: [["1234.560", null], ["0", "text"]], clearExisting: true, firstFileRow: 2 });
    expect(mocks.markDirty).toHaveBeenCalledWith("db");
  });
  it("never retries a failed write or marks it committed", async () => {
    mocks.invoke.mockRejectedValue(new Error("Connection lost"));
    await expect(executeFileImport(target, plan, new AbortController().signal, vi.fn())).rejects.toThrow("Connection lost");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.markDirty).not.toHaveBeenCalled();
  });
  it("does not send data when cancelled during preparation", async () => {
    const controller = new AbortController();
    await expect(executeFileImport(target, plan, controller.signal, () => controller.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("forwards cancellation to the active import operation", async () => {
    const controller = new AbortController();
    let rejectWrite: (error: Error) => void = () => {};
    mocks.invoke.mockImplementation((command: string) => command === "query_import_rows"
      ? new Promise((_, reject) => { rejectWrite = reject; controller.abort(); })
      : Promise.resolve({ completed: 0, total: 2, phase: "validating" }));
    const outcome = executeFileImport(target, plan, controller.signal, vi.fn());
    // The write is intentionally kept pending until its cancellation request has been observed.
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("query_import_status", expect.objectContaining({ connectionId: "db", cancel: true })));
    rejectWrite(new Error("Import cancelled; import changes rolled back."));
    await expect(outcome).rejects.toThrow("Import cancelled");
    expect(mocks.markDirty).not.toHaveBeenCalled();
  });
});
