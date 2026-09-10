import { describe, expect, it } from "vitest";
import type { SchemaTreeNode } from "./connectionTreeService";
import { filterSchemaTree } from "./connectionTreeFilter";

const schemas: SchemaTreeNode[] = [
  {
    name: "dbo",
    status: "loaded",
    errorMessage: null,
    groups: [
      {
        id: "tables",
        objects: [
          {
            name: "CM_Nopkno",
            kind: "table",
            comment: "POS 번호 관리",
          },
          { name: "TB_SALES", kind: "table" },
        ],
      },
    ],
  },
];

describe("filterSchemaTree", () => {
  it("keeps an object visible when its comment matches the explorer filter", () => {
    const [result] = filterSchemaTree(schemas, "번호 관리");

    expect(result.visible).toBe(true);
    expect(result.groups[0]?.objects).toEqual([
      {
        name: "CM_Nopkno",
        kind: "table",
        comment: "POS 번호 관리",
      },
    ]);
  });

  it("still filters by object name when no comment is present", () => {
    const [result] = filterSchemaTree(schemas, "sales");

    expect(result.groups[0]?.objects.map((object) => object.name)).toEqual([
      "TB_SALES",
    ]);
  });

  it("supports * as a case-insensitive wildcard in object names", () => {
    const wildcardSchemas: SchemaTreeNode[] = [
      {
        ...schemas[0],
        groups: [
          {
            id: "tables",
            objects: [{ name: "ORDER_LINE_ITEM", kind: "table" }],
          },
        ],
      },
    ];

    const [result] = filterSchemaTree(wildcardSchemas, "order*item");

    expect(result.groups[0]?.objects.map((object) => object.name)).toEqual([
      "ORDER_LINE_ITEM",
    ]);
  });

  it("supports * as a wildcard in comments", () => {
    const [result] = filterSchemaTree(schemas, "POS*관리");

    expect(result.groups[0]?.objects.map((object) => object.name)).toEqual([
      "CM_Nopkno",
    ]);
  });
});
