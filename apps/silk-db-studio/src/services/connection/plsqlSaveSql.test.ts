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

  it("extracts a square-bracket-quoted identifier (SQL Server style)", () => {
    expect(
      extractPlsqlObjectName("ALTER VIEW [dbo].[MyView] AS SELECT 1", "view"),
    ).toBe("MyView");
  });

  it("extracts a bare square-bracket-quoted identifier with no schema", () => {
    expect(extractPlsqlObjectName("CREATE VIEW [MyView] AS SELECT 1", "view")).toBe(
      "MyView",
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
    const result = buildPlsqlSaveSql("CREATE VIEW myview AS SELECT 1;", ref, "oracle");
    expect(result.sql).toBe("CREATE OR REPLACE VIEW myview AS SELECT 1");
    expect(result.warnings).toContain("Rewrote CREATE to CREATE OR REPLACE.");
  });

  it("warns when the buffer defines a backtick-quoted name that mismatches the tab", () => {
    const result = buildPlsqlSaveSql(
      "CREATE OR REPLACE VIEW `otherview` AS SELECT 1",
      ref,
      "mysql",
    );
    expect(result.warnings.some((w) => w.includes("otherview"))).toBe(true);
  });

  it("does not warn when the backtick-quoted name matches the tab (case-insensitive)", () => {
    const result = buildPlsqlSaveSql(
      "CREATE OR REPLACE VIEW `myview` AS SELECT 1",
      ref,
      "mysql",
    );
    expect(result.warnings).toEqual([]);
  });

  it("leaves Postgres CREATE OR REPLACE untouched (no rewrite, no warning)", () => {
    const result = buildPlsqlSaveSql(
      'CREATE OR REPLACE VIEW "myview" AS SELECT 1',
      ref,
      "postgresql",
    );
    expect(result.sql).toBe('CREATE OR REPLACE VIEW "myview" AS SELECT 1');
    expect(result.warnings).toEqual([]);
  });

  describe("SQL Server", () => {
    it("rewrites plain CREATE VIEW to ALTER VIEW", () => {
      const result = buildPlsqlSaveSql(
        "CREATE VIEW myview AS SELECT 1;",
        ref,
        "sqlserver",
      );
      expect(result.sql).toBe("ALTER VIEW myview AS SELECT 1");
      expect(result.warnings).toContain(
        "Rewrote CREATE to ALTER (SQL Server has no CREATE OR REPLACE VIEW).",
      );
    });

    it("leaves an already-ALTER VIEW buffer unchanged (re-save after prior rewrite)", () => {
      const result = buildPlsqlSaveSql(
        "ALTER VIEW myview AS SELECT 1;",
        ref,
        "sqlserver",
      );
      expect(result.sql).toBe("ALTER VIEW myview AS SELECT 1");
      expect(result.warnings).toEqual([]);
    });

    it("handles square-bracket-quoted identifiers without a mismatch warning", () => {
      const result = buildPlsqlSaveSql(
        "CREATE VIEW [myview] AS SELECT 1",
        ref,
        "sqlserver",
      );
      expect(result.sql).toBe("ALTER VIEW [myview] AS SELECT 1");
      expect(result.warnings).toEqual([
        "Rewrote CREATE to ALTER (SQL Server has no CREATE OR REPLACE VIEW).",
      ]);
    });

    it("warns when a square-bracket-quoted name mismatches the tab", () => {
      const result = buildPlsqlSaveSql(
        "ALTER VIEW [otherview] AS SELECT 1",
        ref,
        "sqlserver",
      );
      expect(result.warnings.some((w) => w.includes("otherview"))).toBe(true);
    });

    it("rejects a buffer that starts with neither CREATE nor ALTER", () => {
      expect(() =>
        buildPlsqlSaveSql("SELECT 1 AS not_a_view", ref, "sqlserver"),
      ).toThrow(/CREATE or ALTER/);
    });
  });

  it("Oracle/Postgres/MySQL still reject a buffer that doesn't start with CREATE", () => {
    expect(() =>
      buildPlsqlSaveSql("ALTER VIEW myview AS SELECT 1", ref, "oracle"),
    ).toThrow(/CREATE \(OR REPLACE\)/);
  });
});
