import { describe, expect, it } from "vitest";
import {
  decodeExplorerObjectDrag,
  encodeExplorerObjectDrag,
} from "./explorerObjectDrag";

describe("explorerObjectDrag", () => {
  it("round-trips payload", () => {
    const raw = encodeExplorerObjectDrag({
      schemaName: "dbo",
      objectName: "SW_MST",
      kind: "table",
      profileId: "p1",
    });
    expect(decodeExplorerObjectDrag(raw)).toEqual({
      schemaName: "dbo",
      objectName: "SW_MST",
      kind: "table",
      profileId: "p1",
    });
  });

  it("rejects invalid payloads", () => {
    expect(decodeExplorerObjectDrag("")).toBeNull();
    expect(decodeExplorerObjectDrag("{}")).toBeNull();
    expect(decodeExplorerObjectDrag('{"schemaName":"dbo"}')).toBeNull();
  });
});
