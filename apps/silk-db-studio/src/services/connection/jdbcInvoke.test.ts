import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Tauri invoke bridge so we can drive success/failure sequences without a real
// Tauri runtime. `mockInvoke` is reassigned per-test via the exported `__invoke` handle.
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockConnect = vi.fn();
const mockIsConnected = vi.fn();
const mockGetProfile = vi.fn();
vi.mock("./connectionService", () => ({
  ConnectionService: {
    connect: (...args: unknown[]) => mockConnect(...args),
    isConnected: (...args: unknown[]) => mockIsConnected(...args),
    getProfile: (...args: unknown[]) => mockGetProfile(...args),
  },
}));

describe("isStaleSessionError", () => {
  it("matches jdbc-agent's requireSession exception message (string error)", async () => {
    const { isStaleSessionError } = await import("./jdbcInvoke");
    expect(
      isStaleSessionError(
        "Connection is not open (abc-123). Connect a database profile in the Connections explorer.",
      ),
    ).toBe(true);
  });

  it("matches when the error is wrapped in an Error object", async () => {
    const { isStaleSessionError } = await import("./jdbcInvoke");
    expect(
      isStaleSessionError(new Error("Connection is not open (abc-123).")),
    ).toBe(true);
  });

  it("does not match unrelated errors", async () => {
    const { isStaleSessionError } = await import("./jdbcInvoke");
    expect(isStaleSessionError(new Error("ORA-00942: table or view does not exist"))).toBe(
      false,
    );
    expect(isStaleSessionError("some other failure")).toBe(false);
    expect(isStaleSessionError(null)).toBe(false);
  });
});

describe("invokeJdbcCommand", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockConnect.mockReset();
    mockIsConnected.mockReset();
    mockGetProfile.mockReset();
  });

  it("returns the result directly on success, with no reconnect attempted", async () => {
    const { invokeJdbcCommand } = await import("./jdbcInvoke");
    mockInvoke.mockResolvedValueOnce({ ok: true });

    const result = await invokeJdbcCommand<{ ok: boolean }>(
      "connection_columns",
      { connectionId: "conn-1" },
      "conn-1",
    );

    expect(result).toEqual({ ok: true });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("rethrows a non-stale-session error unchanged, with no reconnect attempted", async () => {
    const { invokeJdbcCommand } = await import("./jdbcInvoke");
    mockInvoke.mockRejectedValueOnce(new Error("ORA-00942: table or view does not exist"));

    await expect(
      invokeJdbcCommand("connection_columns", { connectionId: "conn-1" }, "conn-1"),
    ).rejects.toThrow("ORA-00942");
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("on a stale-session error, reconnects silently and retries exactly once on success", async () => {
    const { invokeJdbcCommand } = await import("./jdbcInvoke");
    mockInvoke
      .mockRejectedValueOnce(new Error("Connection is not open (conn-1)."))
      .mockResolvedValueOnce({ ok: true });
    mockConnect.mockResolvedValueOnce(undefined);
    mockIsConnected.mockReturnValueOnce(true);

    const result = await invokeJdbcCommand<{ ok: boolean }>(
      "connection_columns",
      { connectionId: "conn-1" },
      "conn-1",
    );

    expect(result).toEqual({ ok: true });
    expect(mockConnect).toHaveBeenCalledWith("conn-1", {
      silent: true,
      promptForPassword: false,
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("throws a clear reconnect-failed error when the silent reconnect itself throws", async () => {
    const { invokeJdbcCommand } = await import("./jdbcInvoke");
    mockInvoke.mockRejectedValueOnce(new Error("Connection is not open (conn-1)."));
    mockConnect.mockRejectedValueOnce(new Error("auth failed"));
    mockIsConnected.mockReturnValueOnce(false);
    mockGetProfile.mockReturnValueOnce({ name: "Prod Oracle" });

    await expect(
      invokeJdbcCommand("connection_columns", { connectionId: "conn-1" }, "conn-1"),
    ).rejects.toThrow(/Prod Oracle/);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("throws a clear reconnect-failed error when reconnect succeeds but the profile is still not connected", async () => {
    const { invokeJdbcCommand } = await import("./jdbcInvoke");
    mockInvoke.mockRejectedValueOnce(new Error("Connection is not open (conn-1)."));
    mockConnect.mockResolvedValueOnce(undefined);
    mockIsConnected.mockReturnValueOnce(false);
    mockGetProfile.mockReturnValueOnce(undefined);

    await expect(
      invokeJdbcCommand("connection_columns", { connectionId: "conn-1" }, "conn-1"),
    ).rejects.toThrow(/conn-1/);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("does not retry a second time when the retry after reconnect also fails", async () => {
    const { invokeJdbcCommand } = await import("./jdbcInvoke");
    mockInvoke
      .mockRejectedValueOnce(new Error("Connection is not open (conn-1)."))
      .mockRejectedValueOnce(new Error("Connection is not open (conn-1)."));
    mockConnect.mockResolvedValueOnce(undefined);
    mockIsConnected.mockReturnValueOnce(true);

    await expect(
      invokeJdbcCommand("connection_columns", { connectionId: "conn-1" }, "conn-1"),
    ).rejects.toThrow("Connection is not open");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});
