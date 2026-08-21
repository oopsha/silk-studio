import { describe, expect, it } from "vitest";
import { buildPlsqlSaveSql, extractPlsqlObjectName } from "./plsqlSaveSql";
import type { PlsqlEditorRef } from "./plsqlEditorConstants";

describe("extractPlsqlObjectName", () => {
  it("extracts a bare identifier", () => {
    expect(extractPlsqlObjectName("CREATE VIEW MY_VIEW AS SELECT 1", "view")).toBe(
      "MY_VIEW",
    );
  });

  it("extracts a double-quoted identifier", () => {
    expect(
      extractPlsqlObjectName('CREATE OR REPLACE VIEW "MySchema"."MyView" AS SELECT 1', "view"),
    ).toBe("MyView");
  });

  it("extracts a backtick-quoted identifier (MySQL/MariaDB style)", () => {
    expect(
      extractPlsqlObjectName("CREATE VIEW `db`.`myview` AS SELECT 1", "view"),
    ).toBe("myview");
  });

  it("extracts a bare backtick-quoted identifier with no schema", () => {
    expect(extractPlsqlObjectName("CREATE VIEW `myview` AS SELECT 1", "view")).toBe(
      "myview",
    );
  });

  it("returns null when the header has clauses before the keyword (MySQL SHOW CREATE VIEW shape)", () => {
    // Known, accepted limitation: MySQL's SHOW CREATE VIEW output includes ALGORITHM=/DEFINER=/
    // SQL SECURITY tokens between CREATE and VIEW, which this best-effort regex does not parse.
    expect(
      extractPlsqlObjectName(
        "CREATE ALGORITHM=UNDEFINED DEFINER=`user`@`host` SQL SECURITY DEFINER VIEW `db`.`v` AS select 1",
        "view",
      ),
    ).toBeNull();
  });
});

describe("buildPlsqlSaveSql", () => {
  const ref: PlsqlEditorRef = {
    profileId: "p1",
    schemaName: "db",
    kind: "view",
    objectName: "myview",
  };

  it("rewrites plain CREATE to CREATE OR REPLACE and strips trailing semicolon", () => {
    const result = buildPlsqlSaveSql("CREATE VIEW myview AS SELECT 1;", ref);
    expect(result.sql).toBe("CREATE OR REPLACE VIEW myview AS SELECT 1");
    expect(result.warnings).toContain("Rewrote CREATE to CREATE OR REPLACE.");
  });

  it("warns when the buffer defines a backtick-quoted name that mismatches the tab", () => {
    const result = buildPlsqlSaveSql(
      "CREATE OR REPLACE VIEW `otherview` AS SELECT 1",
      ref,
    );
    expect(result.warnings.some((w) => w.includes("otherview"))).toBe(true);
  });

  it("does not warn when the backtick-quoted name matches the tab (case-insensitive)", () => {
    const result = buildPlsqlSaveSql(
      "CREATE OR REPLACE VIEW `myview` AS SELECT 1",
      ref,
    );
    expect(result.warnings).toEqual([]);
  });
});
