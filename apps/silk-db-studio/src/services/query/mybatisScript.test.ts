import { describe, expect, it } from "vitest";
import { collectMybatisFields, mergeMybatisParameters, mybatisParameterValues, wrapMybatisScript } from "./mybatisScript";
import { detectSqlParameterOccurrences } from "./sqlParameters";

describe("MyBatis input preparation", () => {
  it("keeps MyBatis placeholders while converting mixed JDBC inputs", () => {
    const sql = `SELECT * FROM T WHERE A = :a AND B = ? <if test="flag">AND C = #{c}</if>`;
    const occurrences = detectSqlParameterOccurrences(sql, {anonymousEnabled:true, namedEnabled:true, mybatisEnabled:true});
    const result = mergeMybatisParameters(sql, occurrences, new Map([
      ["named:a", {isNull:false,value:"01"}], ["anonymous:1", {isNull:true,value:""}],
      ["named:c", {isNull:false,value:"02"}], ["named:flag", {isNull:false,value:"true"}],
    ]));
    expect(result.sql).toContain("#{c}");
    expect(result.sql).not.toContain(":a");
    expect(Object.values(result.parameters)).toEqual(expect.arrayContaining(["01", null, "02", true]));
  });
  it("collects condition-only variables once and ignores property/method names", () => {
    const fields = collectMybatisFields(`SELECT * FROM T <if test='pmsNo != null and pmsNo.toString() neq ""'>WHERE X = #{bizCode} AND Y = #{pmsNo}</if><if test="enabled">AND Z = 1</if>`);
    expect(fields.map(f => f.key)).toEqual(["bizCode", "pmsNo", "enabled"]);
  });
  it("excludes local bind names and discovers dependencies", () => {
    expect(collectMybatisFields(`<bind name="pattern" value="'%' + name + '%'"/>SELECT #{pattern}`).map(f => f.key)).toEqual(["name"]);
  });
  it("protects ordinary SQL operators while preserving dynamic tags", () => {
    expect(wrapMybatisScript(`SELECT * FROM T WHERE X < 10 AND Y & 1 = 1 <if test="a &lt; 2">AND Z = #{a}</if>`)).toContain(`X &lt; 10 AND Y &amp; 1 = 1 <if test="a &lt; 2">`);
  });
  it("preserves leading zeros and accepts OGNL booleans and objects", () => {
    const fields = collectMybatisFields(`SELECT #{code} <if test="flag and person.name != null">WHERE X = #{person.name}</if>`);
    expect(mybatisParameterValues(fields, new Map([
      ["named:code", {isNull:false,value:"001"}],
      ["named:flag", {isNull:false,value:"false"}],
      ["named:person.name", {isNull:false,value:"kim"}],
    ]))).toEqual({code:"001", person:{name:"kim"}, flag:false});
  });
  it("prompts once for each full property path and constructs nested parameters", () => {
    const sql = `SELECT #{reqData.cmp_cd}, #{reqData.menu_btn_grp_cd}, #{reqData.menu_btn_hdr_cd}, #{reqData.cmp_cd}`;
    const fields = collectMybatisFields(sql);
    expect(fields.map(f => f.label)).toEqual(["reqData.cmp_cd", "reqData.menu_btn_grp_cd", "reqData.menu_btn_hdr_cd"]);
    expect(mybatisParameterValues(fields, new Map([
      ["named:reqdata.cmp_cd", {isNull:false,value:"001"}],
      ["named:reqdata.menu_btn_grp_cd", {isNull:false,value:"02"}],
      ["named:reqdata.menu_btn_hdr_cd", {isNull:true,value:""}],
    ]))).toEqual({reqData:{cmp_cd:"001", menu_btn_grp_cd:"02", menu_btn_hdr_cd:null}});
  });
  it("collects nested condition properties without prompting for parent objects or methods", () => {
    expect(collectMybatisFields(`SELECT #{reqData.cmp_cd} <if test='reqData != null and reqData.cmp_cd.toString() neq "" and reqData.enabled'>WHERE 1=1</if>`).map(f => f.key))
      .toEqual(["reqData.cmp_cd", "reqData.enabled"]);
  });
  it("removes mapper statement wrappers and preserves CDATA SQL and placeholders", () => {
    const sql = `<select id="getDtlList" resultType="Map"><![CDATA[SELECT * FROM T WHERE X <= #{reqData.cmp_cd} AND Y & 1 = 1]]></select>`;
    const values = new Map([["named:reqdata.cmp_cd", {isNull:false,value:"001"}]]);
    const result = mergeMybatisParameters(sql, detectSqlParameterOccurrences(sql, {anonymousEnabled:false, namedEnabled:false, mybatisEnabled:true}), values);
    expect(result.sql).toBe(`<script><![CDATA[SELECT * FROM T WHERE X <= #{reqData.cmp_cd} AND Y & 1 = 1]]></script>`);
    expect(result.parameters).toEqual({reqData:{cmp_cd:"001"}});
  });
  it("rejects unsupported external references and array loops before prompting", () => {
    expect(() => collectMybatisFields(`<foreach collection="items">#{item}</foreach>`)).toThrow("foreach");
    expect(() => collectMybatisFields(`<include refid="other"/>`)).toThrow("include");
  });
});
