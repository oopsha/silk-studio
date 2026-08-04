import { describe, expect, it, vi } from "vitest";
import { formatConnectionTargetLabel } from "./connectionTargetLabel";

vi.mock("./connectionService", () => ({
  ConnectionService: {
    getProfile: (id: string) =>
      id === "p1"
        ? {
            id: "p1",
            name: "Prod",
            driverId: "oracle",
            defaultSchema: "HR",
            catalog: "",
            user: "HR",
          }
        : undefined,
    isConnected: (id: string) => id === "p1",
  },
}));

vi.mock("./connectionTypes", async () => {
  const actual = await vi.importActual<typeof import("./connectionTypes")>(
    "./connectionTypes",
  );
  return {
    ...actual,
    effectiveDefaultSchema: () => "HR",
  };
});

describe("formatConnectionTargetLabel", () => {
  const labels = {
    noConnection: "No connection",
    disconnected: "Disconnected · {name}",
  };

  it("shows no connection when unbound", () => {
    expect(
      formatConnectionTargetLabel({ profileId: null }, labels),
    ).toBe("No connection");
  });

  it("shows profile › schema when connected", () => {
    expect(
      formatConnectionTargetLabel(
        { profileId: "p1", schema: "HR" },
        labels,
      ),
    ).toBe("Prod › HR");
  });

  it("shows disconnected when binding points at closed session", () => {
    expect(
      formatConnectionTargetLabel(
        { profileId: "gone", schema: "X" },
        labels,
      ),
    ).toBe("Disconnected · gone");
  });
});
