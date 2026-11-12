import { afterEach, describe, expect, it, vi } from "vitest";
import type { FoundMetadataObject } from "@silk-studio/db-protocol";

vi.mock("./connectionBridge", () => ({ bridgeListMetadata: vi.fn() }));
vi.mock("../formatErrorMessage", () => ({ formatErrorMessage: String }));
const { ConnectionTreeService: service } = await import("./connectionTreeService");

const hit: FoundMetadataObject = {
  catalogName: "SWM", schemaName: "dbo", kind: "procedure", name: "PS_CM_MSG_SEND",
};

afterEach(() => service.dispose());

describe("object search cache lifetime", () => {
  it("accumulates searches without claiming the schema was fully loaded", () => {
    service.addConnectedProfile("p");
    const token = service.getSearchToken("p");
    service.cacheSearchObjects("p", [hit], token);
    service.cacheSearchObjects("p", [hit, { ...hit, name: "PS_CM_BATCH" }], token);
    expect(service.getSearchObjects("p")).toHaveLength(2);
    expect(service.getCache("p").schemas).toEqual([]);
    expect(service.getCache("p").status).toBe("idle");
  });

  it("clears disconnected data and rejects late results even after reconnecting", () => {
    service.addConnectedProfile("p");
    const oldToken = service.getSearchToken("p");
    service.cacheSearchObjects("p", [hit], oldToken);
    service.removeConnectedProfile("p");
    service.addConnectedProfile("p");
    service.cacheSearchObjects("p", [hit], oldToken);
    expect(service.getSearchObjects("p")).toEqual([]);
    service.cacheSearchObjects("p", [hit], service.getSearchToken("p"));
    expect(service.getSearchObjects("p")).toEqual([hit]);
  });

  it("invalidates only matching schema hits and rejects pre-refresh responses", () => {
    service.addConnectedProfile("p");
    const token = service.getSearchToken("p");
    const other = { ...hit, catalogName: "OTHER" };
    service.cacheSearchObjects("p", [hit, other], token);
    service.invalidateSchema("p", "dbo", "SWM");
    service.cacheSearchObjects("p", [hit], token);
    expect(service.getSearchObjects("p")).toEqual([other]);
    service.invalidate("p");
    expect(service.getSearchObjects("p")).toEqual([]);
  });
});
