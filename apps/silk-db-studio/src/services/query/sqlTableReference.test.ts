import { describe, expect, it } from "vitest";
import { parseSingleTableFromSelect } from "./sqlTableReference";

describe("parseSingleTableFromSelect", () => {
  it("parses a plain single-table select", () => {
    expect(parseSingleTableFromSelect("SELECT * FROM T1 WHERE X = 1")).toEqual({
      schema: null,
      table: "T1",
    });
  });

  it("parses a schema-qualified table with alias", () => {
    expect(
      parseSingleTableFromSelect("SELECT T1.* FROM SCHEMA1.T1 T1 WHERE T1.X = 1"),
    ).toEqual({ schema: "SCHEMA1", table: "T1" });
  });

  it("parses a database.schema.table (SQL Server 3-part) reference", () => {
    expect(
      parseSingleTableFromSelect("SELECT * FROM PSM.dbo.PST_PAYMENT_50"),
    ).toEqual({ schema: "dbo", table: "PST_PAYMENT_50" });
  });

  it("parses a database.schema.table reference with a trailing WHERE", () => {
    expect(
      parseSingleTableFromSelect(
        "SELECT * FROM PSM.dbo.PST_PAYMENT_50 WHERE ID = 1",
      ),
    ).toEqual({ schema: "dbo", table: "PST_PAYMENT_50" });
  });

  it("parses a SQL Server bracket-quoted schema.table reference", () => {
    expect(
      parseSingleTableFromSelect("SELECT * FROM [dbo].[POS_SETTING_XYZ]"),
    ).toEqual({ schema: "dbo", table: "POS_SETTING_XYZ" });
  });

  it("parses a SQL Server bracket-quoted database.schema.table reference", () => {
    expect(
      parseSingleTableFromSelect("SELECT * FROM [PSM].[dbo].[PST_PAYMENT_50]"),
    ).toEqual({ schema: "dbo", table: "PST_PAYMENT_50" });
  });

  it("parses a bracket-quoted table with an alias", () => {
    expect(
      parseSingleTableFromSelect("SELECT * FROM [dbo].[T1] T1 WHERE T1.X = 1"),
    ).toEqual({ schema: "dbo", table: "T1" });
  });

  it("allows a JOIN nested inside a WHERE subquery", () => {
    const sql = `SELECT T1.*
  FROM BBA020MS T1
 WHERE T1.CUST_NO          IN (
                                SELECT S1.CUST_NO
                                  FROM BBA012MS S1
                                 INNER JOIN
                                       BBA010MS S2
                                    ON S2.MEMBER_SEQ        = S1.MEMBER_SEQ
                                 WHERE S1.CAP_MEMBER_NO     = '0001088600'
                                   AND S1.BIZ_CODE          = '51'
                                   AND S2.USE_YN            = 'Y'
                              )
   AND T1.USE_YN            = 'Y'
;`;
    expect(parseSingleTableFromSelect(sql)).toEqual({
      schema: null,
      table: "BBA020MS",
    });
  });

  it("allows a plain subquery in WHERE with no join", () => {
    const sql = `SELECT T1.*
  FROM BBA020MS T1
 WHERE T1.CUST_NO          IN (
                                SELECT S1.CUST_NO
                                  FROM BBA012MS S1
                                 WHERE S1.CAP_MEMBER_NO     = '0001088600'
                                   AND S1.BIZ_CODE          = '51'
                              )
   AND T1.USE_YN            = 'Y'
;`;
    expect(parseSingleTableFromSelect(sql)).toEqual({
      schema: null,
      table: "BBA020MS",
    });
  });

  it("allows a UNION nested inside a WHERE subquery", () => {
    const sql = `SELECT T1.*
  FROM BBA020MS T1
 WHERE T1.CUST_NO IN (SELECT S1.CUST_NO FROM BBA012MS S1
                       UNION
                       SELECT S2.CUST_NO FROM BBA013MS S2)`;
    expect(parseSingleTableFromSelect(sql)).toEqual({
      schema: null,
      table: "BBA020MS",
    });
  });

  it("rejects an outer JOIN immediately after the base table", () => {
    const sql = "SELECT T1.* FROM T1 INNER JOIN T2 ON T2.ID = T1.ID";
    expect(parseSingleTableFromSelect(sql)).toBeNull();
  });

  it("rejects an outer comma join", () => {
    expect(parseSingleTableFromSelect("SELECT * FROM T1, T2 WHERE T1.ID = T2.ID")).toBeNull();
  });

  it("rejects a top-level UNION", () => {
    expect(
      parseSingleTableFromSelect("SELECT * FROM T1 UNION SELECT * FROM T2"),
    ).toBeNull();
  });

  it("rejects a subquery-derived FROM", () => {
    expect(parseSingleTableFromSelect("SELECT * FROM (SELECT * FROM T1) X")).toBeNull();
  });

  it("rejects non-select statements", () => {
    expect(parseSingleTableFromSelect("UPDATE T1 SET X = 1")).toBeNull();
  });

  it("ignores a leading line comment above the query", () => {
    const sql = `-- 저장 차단
SELECT T1.*
  FROM BBA020MS T1
 WHERE T1.CUST_NO          IN (
                                SELECT S1.CUST_NO
                                  FROM BBA012MS S1
                                 INNER JOIN
                                       BBA010MS S2
                                    ON S2.MEMBER_SEQ        = S1.MEMBER_SEQ
                                 WHERE S1.CAP_MEMBER_NO     = '0001088600'
                                   AND S1.BIZ_CODE          = '51'
                                   AND S2.USE_YN            = 'Y'
                              )
   AND T1.USE_YN            = 'Y'
;`;
    expect(parseSingleTableFromSelect(sql)).toEqual({
      schema: null,
      table: "BBA020MS",
    });
  });

  it("ignores a block comment and a trailing line comment", () => {
    const sql = `/* note */ SELECT * FROM T1 WHERE X = 1 -- trailing`;
    expect(parseSingleTableFromSelect(sql)).toEqual({
      schema: null,
      table: "T1",
    });
  });

  it("doesn't treat -- inside a string literal as a comment", () => {
    expect(
      parseSingleTableFromSelect("SELECT * FROM T1 WHERE NOTE = '--not a comment'"),
    ).toEqual({ schema: null, table: "T1" });
  });
});
