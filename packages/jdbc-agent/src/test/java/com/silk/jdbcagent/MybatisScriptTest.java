package com.silk.jdbcagent;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class MybatisScriptTest {
  private static final ObjectMapper JSON = new ObjectMapper();

  @Test void excludedConditionDoesNotBindUnusedParameters() throws Exception {
    var request = JSON.readTree("{\"parameters\":{\"pmsNo\":\"\",\"bizCode\":\"51\"}}");
    ((com.fasterxml.jackson.databind.node.ObjectNode) request).put("sql",
        "<script>SELECT 1 <if test='pmsNo != null and pmsNo.toString() neq &quot;&quot;'>WHERE X = #{bizCode} AND Y = #{pmsNo}</if></script>");
    var result = MybatisScript.prepare(request);
    assertEquals("SELECT 1", result.path("sql").asText());
    assertEquals(0, result.path("binds").size());
  }

  @Test void includedConditionBindsOnlyActiveBranch() throws Exception {
    var request = JSON.readTree("{\"parameters\":{\"pmsNo\":\"123\",\"bizCode\":\"51\"}}");
    ((com.fasterxml.jackson.databind.node.ObjectNode) request).put("sql",
        "<script>SELECT 1 <where><if test='pmsNo != null and pmsNo != &quot;&quot;'>AND X = #{bizCode} AND Y = #{pmsNo}</if></where></script>");
    var result = MybatisScript.prepare(request);
    assertTrue(result.path("sql").asText().contains("WHERE"));
    assertEquals(JSON.readTree("[\"51\",\"123\"]"), result.path("binds"));
  }

  @Test void chooseBindAndLiteralSubstitutionUseMybatisSemantics() throws Exception {
    var request = JSON.readTree("{\"parameters\":{\"name\":\"kim\",\"table\":\"people\",\"enabled\":true}}");
    ((com.fasterxml.jackson.databind.node.ObjectNode) request).put("sql",
        "<script><bind name='pattern' value='&quot;%&quot; + name + &quot;%&quot;'/>SELECT * FROM ${table}<choose><when test='enabled'> WHERE name LIKE #{pattern}</when><otherwise> WHERE 1=0</otherwise></choose></script>");
    var result = MybatisScript.prepare(request);
    assertTrue(result.path("sql").asText().contains("FROM people"));
    assertEquals(JSON.readTree("[\"%kim%\"]"), result.path("binds"));
  }
}
