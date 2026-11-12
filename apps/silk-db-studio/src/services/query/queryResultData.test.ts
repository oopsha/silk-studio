import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QueryResultDataService } from "./queryResultDataService";
import { QueryResultDirtyService as edits } from "./queryResultDirtyService";

const id = "rows-test";
const columns = ["id", "value"];
beforeEach(() => edits.initTab(id, columns, [["1", "before"], ["2", "other"]]));
afterEach(() => { edits.removeTab(id); edits.removeTab("other-grid"); });

describe("single server baseline and derived grid rows", () => {
  it("keeps the server baseline intact while applying and discarding edits", () => {
    const originalView = edits.getDisplayRows(id);
    edits.setCell(id, 0, "value", "edited");
    expect(edits.getDisplayRows(id)[0].value).toBe("edited");
    expect(edits.getDisplayRows(id)[1]).toBe(originalView[1]);
    expect(QueryResultDataService.getRow(id, 0)?.value).toBe("before");
    expect(edits.getDirtyRows(id)[0].changes[0].originalValue).toBe("before");
    edits.clearTab(id);
    expect(edits.getDisplayRows(id)[0].value).toBe("before");
  });

  it("appends a server page without losing edits or a duplicated row", () => {
    edits.setCell(id, 0, "value", "edited");
    const duplicate = edits.duplicateRow(id, 0)!;
    edits.appendOriginalRows(id, 2, columns, [["3", "page-two"]]);
    expect(edits.getDisplayRows(id).map((row) => row.__rowIndex)).toEqual(["0", String(duplicate), "1", "2"]);
    expect(edits.getDisplayRows(id).map((row) => row.value)).toEqual(["edited", "edited", "other", "page-two"]);
    edits.setCell(id, 2, "value", "changed-page");
    expect(edits.getDirtyRows(id).find((row) => row.rowIndex === 2)?.changes[0].originalValue).toBe("page-two");
  });

  it("replaces a filtered result and uses its current row identity when building changes", () => {
    edits.replaceOriginalRows(id, columns, [["900", "filtered"]]);
    edits.setCell(id, 0, "value", "filtered-edit");
    expect(edits.getOriginalRows(id)).toEqual([{ id: "900", value: "filtered" }]);
    expect(edits.getDisplayRows(id)[0]).toMatchObject({ id: "900", value: "filtered-edit" });
    expect(edits.getDirtyRows(id)[0].changes[0].originalValue).toBe("filtered");
  });

  it("replaces saved values with fresh server values without reviving the old view on remount", () => {
    edits.setCell(id, 0, "value", "saved");
    edits.replaceOriginalRows(id, columns, [["1", "saved"]]);
    expect(edits.hasPendingChanges(id)).toBe(false);
    expect(edits.getDisplayRows(id)[0].value).toBe("saved");
    // Represents a subsequent authoritative refresh, for example after a rollback.
    edits.replaceOriginalRows(id, columns, [["1", "before"]]);
    edits.initTab(id, columns, [["1", "stale-transport-payload"]]);
    expect(edits.getDisplayRows(id)[0].value).toBe("before");
    expect(edits.getOriginalRows(id)[0].value).toBe("before");
  });

  it("stages imports as changes and restores all server rows after cancelling truncate", () => {
    edits.setTruncateBeforeImport(id, true);
    edits.addImportedRows(id, columns, [{ id: "3", value: "import" }, { id: "4", value: "import-2" }], null);
    expect(edits.getDisplayRows(id).map((row) => row.id)).toEqual(["3", "4"]);
    expect(QueryResultDataService.getRow(id, 0)?.id).toBe("1");
    edits.clearTab(id);
    expect(edits.getDisplayRows(id).map((row) => row.id)).toEqual(["1", "2"]);
  });

  it("does not allow a grid row object to mutate the authoritative server row", () => {
    edits.getDisplayRows(id)[0].value = "grid-mutated";
    expect(QueryResultDataService.getRow(id, 0)?.value).toBe("before");
    edits.setCell(id, 0, "value", "grid-mutated");
    expect(edits.getDirtyRows(id)[0].changes[0].originalValue).toBe("before");
  });

  it("keeps snapshots stable when another grid changes, and removes baseline on close", () => {
    const snapshot = edits.getDisplayRows(id);
    edits.initTab("other-grid", columns, [["99", "unrelated"]]);
    edits.setCell("other-grid", 0, "value", "changed");
    expect(edits.getDisplayRows(id)).toBe(snapshot);
    edits.removeTab(id);
    expect(QueryResultDataService.getRow(id, 0)).toBeNull();
    expect(edits.getDisplayRows(id)).toEqual([]);
  });
});
