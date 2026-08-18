import { describe, expect, it } from "vitest";
import {
  bindSqlParameters,
  detectSqlParameterFields,
  detectSqlParameterOccurrences,
  parameterValueKey,
  type SqlParameterValue,
} from "./sqlParameters";

const both = {
  anonymousEnabled: true,
  namedEnabled: true,
};

describe("detectSqlParameterOccurrences", () => {
  it("detects named and anonymous placeholders", () => {
    const sql = "SELECT * FROM t WHERE a = :biz AND b = ? AND c = :biz";
    const occurrences = detectSqlParameterOccurrences(sql, both);
    expect(occurrences.map((item) => item.label)).toEqual([
      ":biz",
      "?1",
      ":biz",
    ]);
    expect(detectSqlParameterFields(sql, both).map((item) => item.label)).toEqual([
      ":biz",
      "?1",
    ]);
  });

  it("ignores placeholders inside strings and comments", () => {
    const sql = `
      SELECT ':biz', "?", -- :skip
      /* ? :x */ x FROM t WHERE id = :id
    `;
    const occurrences = detectSqlParameterOccurrences(sql, both);
    expect(occurrences.map((item) => item.label)).toEqual([":id"]);
  });

  it("skips PostgreSQL :: casts", () => {
    const sql = "SELECT id::text, :name FROM t";
    const occurrences = detectSqlParameterOccurrences(sql, {
      anonymousEnabled: false,
      namedEnabled: true,
    });
    expect(occurrences.map((item) => item.label)).toEqual([":name"]);
  });

  it("detects MyBatis-style #{name} placeholders with a custom named prefix", () => {
    const sql =
      "SELECT * FROM t WHERE a = #{CTOR_SEQ} AND b LIKE #{COM_CD,jdbcType=VARCHAR}";
    const occurrences = detectSqlParameterOccurrences(sql, {
      anonymousEnabled: false,
      namedEnabled: true,
      namedPrefix: "#",
    });
    expect(occurrences.map((item) => item.label)).toEqual([
      "#{CTOR_SEQ}",
      "#{COM_CD}",
    ]);
    expect(occurrences.map((item) => item.key)).toEqual(["CTOR_SEQ", "COM_CD"]);
    const bound = bindSqlParameters(
      sql,
      occurrences,
      new Map<string, SqlParameterValue>([
        [parameterValueKey("named", "CTOR_SEQ"), { isNull: false, value: "1" }],
        [parameterValueKey("named", "COM_CD"), { isNull: false, value: "001" }],
      ]),
    );
    expect(bound.sql).toBe("SELECT * FROM t WHERE a = ? AND b LIKE ?");
    expect(bound.binds).toEqual(["1", "001"]);
  });

  it("recognizes MyBatis #{}/${} placeholders alongside :name when mybatisEnabled is set", () => {
    const sql =
      "SELECT * FROM t WHERE a = :biz AND b = #{ctorSeq} AND c = ${rawCol,jdbcType=VARCHAR}";
    const occurrences = detectSqlParameterOccurrences(sql, {
      anonymousEnabled: false,
      namedEnabled: true,
      mybatisEnabled: true,
    });
    expect(occurrences.map((item) => item.label)).toEqual([
      ":biz",
      "#{ctorSeq}",
      "${rawCol}",
    ]);
    expect(occurrences.map((item) => item.key)).toEqual([
      "biz",
      "ctorSeq",
      "rawCol",
    ]);
  });

  it("mybatisEnabled works even when the : prefix is disabled", () => {
    const sql = "SELECT * FROM t WHERE a = #{x} AND b = :y";
    const occurrences = detectSqlParameterOccurrences(sql, {
      anonymousEnabled: false,
      namedEnabled: false,
      mybatisEnabled: true,
    });
    expect(occurrences.map((item) => item.label)).toEqual(["#{x}"]);
  });

  it("respects enable flags", () => {
    const sql = "SELECT :a, ?";
    expect(
      detectSqlParameterOccurrences(sql, {
        anonymousEnabled: false,
        namedEnabled: false,
      }),
    ).toEqual([]);
    expect(
      detectSqlParameterOccurrences(sql, {
        anonymousEnabled: true,
        namedEnabled: false,
      }).map((item) => item.label),
    ).toEqual(["?1"]);
  });
});

describe("bindSqlParameters", () => {
  it("rewrites to positional binds and reuses named values", () => {
    const sql = "SELECT :biz, ?, :biz";
    const occurrences = detectSqlParameterOccurrences(sql, both);
    const values = new Map<string, SqlParameterValue>([
      [parameterValueKey("named", "biz"), { isNull: false, value: "A" }],
      [parameterValueKey("anonymous", "1"), { isNull: true, value: "" }],
    ]);
    const bound = bindSqlParameters(sql, occurrences, values);
    expect(bound.sql).toBe("SELECT ?, ?, ?");
    expect(bound.binds).toEqual(["A", null, "A"]);
  });
});
