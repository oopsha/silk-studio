import { beforeEach, describe, expect, it } from "vitest";
import type { ObjectEditorRef } from "./objectEditorConstants";
import {
  clearAllObjectPreviewCache,
  getCachedObjectPreview,
  invalidateObjectPreviewCache,
  setCachedObjectPreview,
} from "./objectPreviewCache";

function ref(overrides: Partial<ObjectEditorRef> = {}): ObjectEditorRef {
  return {
    profileId: "p1",
    schemaName: "HR",
    kind: "table",
    objectName: "EMPLOYEES",
    ...overrides,
  };
}

describe("objectPreviewCache", () => {
  beforeEach(() => {
    clearAllObjectPreviewCache();
  });

  it("returns undefined when nothing is cached", () => {
    expect(getCachedObjectPreview("columns", ref())).toBeUndefined();
  });

  it("returns the exact value that was set, without serializing it", () => {
    const primaryKeyNames = new Set(["id"]);
    const value = { columns: [{ name: "id" }], primaryKeyNames };
    setCachedObjectPreview("columns", ref(), value);

    const cached = getCachedObjectPreview<typeof value>("columns", ref());
    expect(cached).toBe(value);
    expect(cached?.primaryKeyNames).toBe(primaryKeyNames);
  });

  it("keeps entries for different kinds of the same object separate", () => {
    setCachedObjectPreview("columns", ref(), { columns: [] });
    expect(getCachedObjectPreview("indexes", ref())).toBeUndefined();
  });

  it("keeps entries for different objects separate", () => {
    setCachedObjectPreview("columns", ref(), { columns: ["a"] });
    setCachedObjectPreview("columns", ref({ objectName: "DEPARTMENTS" }), {
      columns: ["b"],
    });

    expect(getCachedObjectPreview("columns", ref())).toEqual({
      columns: ["a"],
    });
    expect(
      getCachedObjectPreview("columns", ref({ objectName: "DEPARTMENTS" })),
    ).toEqual({ columns: ["b"] });
  });

  it("keeps entries for different schemas of the same object name separate", () => {
    setCachedObjectPreview("columns", ref({ schemaName: "HR" }), {
      columns: ["hr"],
    });
    setCachedObjectPreview("columns", ref({ schemaName: "SALES" }), {
      columns: ["sales"],
    });

    expect(
      getCachedObjectPreview("columns", ref({ schemaName: "HR" })),
    ).toEqual({ columns: ["hr"] });
    expect(
      getCachedObjectPreview("columns", ref({ schemaName: "SALES" })),
    ).toEqual({ columns: ["sales"] });
  });

  it("keeps entries for different profiles separate", () => {
    setCachedObjectPreview("columns", ref({ profileId: "p1" }), {
      columns: ["p1"],
    });
    setCachedObjectPreview("columns", ref({ profileId: "p2" }), {
      columns: ["p2"],
    });

    expect(
      getCachedObjectPreview("columns", ref({ profileId: "p1" })),
    ).toEqual({ columns: ["p1"] });
    expect(
      getCachedObjectPreview("columns", ref({ profileId: "p2" })),
    ).toEqual({ columns: ["p2"] });
  });

  it("keeps entries for different catalogs separate", () => {
    setCachedObjectPreview("columns", ref({ catalogName: "DB1" }), {
      columns: ["db1"],
    });
    setCachedObjectPreview("columns", ref({ catalogName: "DB2" }), {
      columns: ["db2"],
    });
    setCachedObjectPreview("columns", ref({ catalogName: undefined }), {
      columns: ["none"],
    });

    expect(
      getCachedObjectPreview("columns", ref({ catalogName: "DB1" })),
    ).toEqual({ columns: ["db1"] });
    expect(
      getCachedObjectPreview("columns", ref({ catalogName: "DB2" })),
    ).toEqual({ columns: ["db2"] });
    expect(
      getCachedObjectPreview("columns", ref({ catalogName: undefined })),
    ).toEqual({ columns: ["none"] });
  });

  it("invalidateObjectPreviewCache with just profileId clears everything for that profile only", () => {
    setCachedObjectPreview("columns", ref({ profileId: "p1" }), {
      columns: ["p1"],
    });
    setCachedObjectPreview("indexes", ref({ profileId: "p1" }), {
      indexes: ["p1"],
    });
    setCachedObjectPreview("columns", ref({ profileId: "p2" }), {
      columns: ["p2"],
    });

    invalidateObjectPreviewCache("p1");

    expect(
      getCachedObjectPreview("columns", ref({ profileId: "p1" })),
    ).toBeUndefined();
    expect(
      getCachedObjectPreview("indexes", ref({ profileId: "p1" })),
    ).toBeUndefined();
    expect(
      getCachedObjectPreview("columns", ref({ profileId: "p2" })),
    ).toEqual({ columns: ["p2"] });
  });

  it("invalidateObjectPreviewCache with profileId + schemaName clears just that schema", () => {
    setCachedObjectPreview("columns", ref({ schemaName: "HR" }), {
      columns: ["hr"],
    });
    setCachedObjectPreview("columns", ref({ schemaName: "SALES" }), {
      columns: ["sales"],
    });

    invalidateObjectPreviewCache("p1", "HR");

    expect(
      getCachedObjectPreview("columns", ref({ schemaName: "HR" })),
    ).toBeUndefined();
    expect(
      getCachedObjectPreview("columns", ref({ schemaName: "SALES" })),
    ).toEqual({ columns: ["sales"] });
  });

  it("invalidateObjectPreviewCache with profileId + schemaName + objectName clears just that object", () => {
    setCachedObjectPreview("columns", ref({ objectName: "EMPLOYEES" }), {
      columns: ["employees"],
    });
    setCachedObjectPreview("indexes", ref({ objectName: "EMPLOYEES" }), {
      indexes: ["employees"],
    });
    setCachedObjectPreview("columns", ref({ objectName: "DEPARTMENTS" }), {
      columns: ["departments"],
    });

    invalidateObjectPreviewCache("p1", "HR", "EMPLOYEES");

    expect(
      getCachedObjectPreview("columns", ref({ objectName: "EMPLOYEES" })),
    ).toBeUndefined();
    expect(
      getCachedObjectPreview("indexes", ref({ objectName: "EMPLOYEES" })),
    ).toBeUndefined();
    expect(
      getCachedObjectPreview("columns", ref({ objectName: "DEPARTMENTS" })),
    ).toEqual({ columns: ["departments"] });
  });

  it("clearAllObjectPreviewCache wipes every entry for every profile", () => {
    setCachedObjectPreview("columns", ref({ profileId: "p1" }), {
      columns: ["p1"],
    });
    setCachedObjectPreview("columns", ref({ profileId: "p2" }), {
      columns: ["p2"],
    });

    clearAllObjectPreviewCache();

    expect(
      getCachedObjectPreview("columns", ref({ profileId: "p1" })),
    ).toBeUndefined();
    expect(
      getCachedObjectPreview("columns", ref({ profileId: "p2" })),
    ).toBeUndefined();
  });
});
