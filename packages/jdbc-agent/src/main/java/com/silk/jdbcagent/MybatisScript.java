package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.ParameterMapping;
import org.apache.ibatis.reflection.MetaObject;
import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;

/** SQL preparation only: never opens a SqlSession or changes JDBC transactions. */
final class MybatisScript {
  private static final ObjectMapper MAPPER = new ObjectMapper();

  static ObjectNode prepare(JsonNode request) {
    String script = request.path("sql").asText();
    Configuration configuration = new Configuration();
    Map<String, Object> parameters = MAPPER.convertValue(request.path("parameters"), new TypeReference<Map<String, Object>>() {});
    BoundSql bound = new XMLLanguageDriver()
        .createSqlSource(configuration, script, Map.class).getBoundSql(parameters);
    MetaObject values = configuration.newMetaObject(parameters);
    ObjectNode result = MAPPER.createObjectNode();
    result.put("sql", bound.getSql());
    var binds = result.putArray("binds");
    for (ParameterMapping mapping : bound.getParameterMappings()) {
      String property = mapping.getProperty();
      Object value = bound.hasAdditionalParameter(property)
          ? bound.getAdditionalParameter(property) : values.getValue(property);
      if (value == null) binds.addNull();
      else binds.add(String.valueOf(value));
    }
    return result;
  }
}
