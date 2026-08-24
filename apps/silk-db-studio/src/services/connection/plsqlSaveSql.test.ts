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
    expect(result.statements).toEqual(["CREATE OR REPLACE VIEW myview AS SELECT 1"]);
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
    expect(result.statements).toEqual(['CREATE OR REPLACE VIEW "myview" AS SELECT 1']);
    expect(result.warnings).toEqual([]);
  });

  describe("SQL Server", () => {
    it("rewrites plain CREATE VIEW to ALTER VIEW", () => {
      const result = buildPlsqlSaveSql(
        "CREATE VIEW myview AS SELECT 1;",
        ref,
        "sqlserver",
      );
      expect(result.statements).toEqual(["ALTER VIEW myview AS SELECT 1"]);
      expect(result.warnings).toContain(
        "Rewrote CREATE to ALTER (SQL Server has no CREATE OR REPLACE).",
      );
    });

    it("leaves an already-ALTER VIEW buffer unchanged (re-save after prior rewrite)", () => {
      const result = buildPlsqlSaveSql(
        "ALTER VIEW myview AS SELECT 1;",
        ref,
        "sqlserver",
      );
      expect(result.statements).toEqual(["ALTER VIEW myview AS SELECT 1"]);
      expect(result.warnings).toEqual([]);
    });

    it("handles square-bracket-quoted identifiers without a mismatch warning", () => {
      const result = buildPlsqlSaveSql(
        "CREATE VIEW [myview] AS SELECT 1",
        ref,
        "sqlserver",
      );
      expect(result.statements).toEqual(["ALTER VIEW [myview] AS SELECT 1"]);
      expect(result.warnings).toEqual([
        "Rewrote CREATE to ALTER (SQL Server has no CREATE OR REPLACE).",
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

  describe("MySQL/MariaDB procedures and functions (no CREATE OR REPLACE)", () => {
    const procedureRef: PlsqlEditorRef = {
      profileId: "p1",
      schemaName: "db",
      kind: "procedure",
      objectName: "myproc",
    };

    it("builds a DROP IF EXISTS + CREATE pair, leaving CREATE unrewritten", () => {
      const result = buildPlsqlSaveSql(
        "CREATE PROCEDURE `db`.`myproc`() BEGIN SELECT 1; END",
        procedureRef,
        "mysql",
      );
      // stripTrailingSemicolon treats a CREATE PROCEDURE/FUNCTION body as a PL/SQL block that
      // needs its trailing `;` kept/added (existing, driver-agnostic behavior — harmless for a
      // single-statement MySQL execute call too).
      expect(result.statements).toEqual([
        "DROP PROCEDURE IF EXISTS `db`.`myproc`",
        "CREATE PROCEDURE `db`.`myproc`() BEGIN SELECT 1; END;",
      ]);
      expect(
        result.warnings.some((w) => w.includes("two separate statements")),
      ).toBe(true);
    });

    it("does the same for MariaDB functions, using DROP FUNCTION", () => {
      const functionRef: PlsqlEditorRef = {
        profileId: "p1",
        schemaName: "db",
        kind: "function",
        objectName: "myfunc",
      };
      const result = buildPlsqlSaveSql(
        "CREATE FUNCTION `db`.`myfunc`() RETURNS INT BEGIN RETURN 1; END",
        functionRef,
        "mariadb",
      );
      expect(result.statements[0]).toBe("DROP FUNCTION IF EXISTS `db`.`myfunc`");
      expect(result.statements[1]).toBe(
        "CREATE FUNCTION `db`.`myfunc`() RETURNS INT BEGIN RETURN 1; END;",
      );
    });

    it("does not rewrite CREATE to CREATE OR REPLACE for MySQL procedures (invalid syntax there)", () => {
      const result = buildPlsqlSaveSql(
        "CREATE PROCEDURE myproc() BEGIN SELECT 1; END",
        procedureRef,
        "mysql",
      );
      expect(result.statements[1]).not.toMatch(/CREATE OR REPLACE/i);
    });

    it("still rewrites CREATE to CREATE OR REPLACE for MySQL views (unaffected by the routine branch)", () => {
      const result = buildPlsqlSaveSql(
        "CREATE VIEW myview AS SELECT 1",
        ref,
        "mysql",
      );
      expect(result.statements).toEqual(["CREATE OR REPLACE VIEW myview AS SELECT 1"]);
    });
  });
});
