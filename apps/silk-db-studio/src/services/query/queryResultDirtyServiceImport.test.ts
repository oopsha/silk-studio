import { afterEach, describe, expect, it } from "vitest";
import { QueryResultDirtyService } from "./queryResultDirtyService";

const tabId = `import-test-${crypto.randomUUID()}`;

afterEach(() => QueryResultDirtyService.removeTab(tabId));

describe("QueryResultDirtyService.addImportedRows", () => {
  it("stages imported records as ordered new rows anchored to the grid", () => {
    QueryResultDirtyService.initTab(tabId, ["id", "name"], [["1", "Ada"]]);
    const indexes = QueryResultDirtyService.addImportedRows(tabId, ["id", "name"], [
      { id: "2", name: "Lin" },
      { id: "3", name: "Grace" },
    ], 0);

    expect(indexes).toHaveLength(2);
    expect(QueryResultDirtyService.getNewRowAnchor(tabId, indexes[0])).toBe(0);
    expect(QueryResultDirtyService.getNewRowAnchor(tabId, indexes[1])).toBe(indexes[0]);
    expect(QueryResultDirtyService.getEffectiveRow(tabId, indexes[0])).toEqual({ id: "2", name: "Lin" });
    expect(QueryResultDirtyService.getEffectiveRow(tabId, indexes[1])).toEqual({ id: "3", name: "Grace" });
    expect(QueryResultDirtyService.getNewRowCount(tabId)).toBe(2);
  });
});
