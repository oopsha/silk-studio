import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), install: vi.fn(), check: vi.fn(), ask: vi.fn(), relaunch: vi.fn(), show: vi.fn(), log: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("../notifications/appNotificationService", () => ({ AppNotificationService: { show: mocks.show } }));
vi.mock("../diagnostics/appLogService", () => ({ AppLogService: { error: mocks.log } }));
vi.mock("../../platform/i18n/activeLocale", () => ({ tKey: (key: string) => `${key} {version} {message}` }));
import { checkForUpdates } from "./updateService";

describe("update download progress", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.ask.mockResolvedValue(true); mocks.invoke.mockResolvedValue(undefined); mocks.install.mockResolvedValue(undefined); });

  it("shows persistent byte progress, switches to installing, and relaunches", async () => {
    mocks.check.mockResolvedValue({ version: "0.1.15", install: mocks.install, download: async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 2 * 1024 * 1024 } });
      onEvent({ event: "Progress", data: { chunkLength: 2 * 1024 * 1024 } });
      onEvent({ event: "Finished" });
    } });
    await checkForUpdates();
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining("100% · 2.0 MB / 2.0 MB"), "info", 0, 100);
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining("installing"), "info", 0, null);
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("uses indeterminate progress when total size is unavailable", async () => {
    mocks.check.mockResolvedValue({ version: "0.1.15", install: mocks.install, download: async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: {} });
    } });
    await checkForUpdates();
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining("0.0 MB"), "info", 0, null);
  });

  it("reports download failure even after a background update check", async () => {
    mocks.check.mockResolvedValue({ version: "0.1.15", install: mocks.install, download: async () => { throw new Error("network disconnected"); } });
    await checkForUpdates({ silentWhenUpToDate: true });
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining("network disconnected"), "error");
    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("waits for runtime shutdown before launching the installer", async () => {
    let completeShutdown!: () => void;
    mocks.invoke.mockImplementation(() => new Promise<void>((resolve) => { completeShutdown = resolve; }));
    mocks.check.mockResolvedValue({ version: "0.1.19", download: vi.fn(), install: mocks.install });
    const updating = checkForUpdates();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("update_prepare_install"));
    expect(mocks.install).not.toHaveBeenCalled();
    completeShutdown();
    await updating;
    expect(mocks.install).toHaveBeenCalledOnce();
  });

  it("does not install if runtime shutdown fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("shutdown failed"));
    mocks.check.mockResolvedValue({ version: "0.1.19", download: vi.fn(), install: mocks.install });
    await checkForUpdates();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith(expect.stringContaining("shutdown failed"), "error");
  });
});
