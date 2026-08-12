package com.silk.jdbcagent;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Shared helper for {@link DbDialect#collectTableForeignKeys} — wraps the driver-generic {@link
 * DatabaseMetaData#getImportedKeys}.
 */
final class MetadataForeignKeys {
  private MetadataForeignKeys() {}

  private static final class FkBuilder {
    String referencedSchema;
    String referencedTable;
    String updateRule;
    String deleteRule;
    final TreeMap<Integer, String> columns = new TreeMap<>();
    final TreeMap<Integer, String> referencedColumns = new TreeMap<>();
  }

  static void appendFromResultSet(ResultSet rs, ArrayNode foreignKeys) throws SQLException {
    Map<String, FkBuilder> byName = new LinkedHashMap<>();
    List<String> order = new ArrayList<>();
    while (rs.next()) {
      String fkColumn = rs.getString("FKCOLUMN_NAME");
      if (fkColumn == null || fkColumn.isBlank()) {
        continue;
      }
      int keySeq = rs.getInt("KEY_SEQ");
      String pkTable = rs.getString("PKTABLE_NAME");
      String name = rs.getString("FK_NAME");
      if (name == null || name.isBlank()) {
        name = "fk_" + (pkTable == null ? "unknown" : pkTable);
      }
      FkBuilder builder = byName.get(name);
      if (builder == null) {
        builder = new FkBuilder();
        builder.referencedSchema = rs.getString("PKTABLE_SCHEM");
        builder.referencedTable = pkTable;
        builder.updateRule = ruleName(rs.getShort("UPDATE_RULE"));
        builder.deleteRule = ruleName(rs.getShort("DELETE_RULE"));
        byName.put(name, builder);
        order.add(name);
      }
      builder.columns.put(keySeq, fkColumn);
      builder.referencedColumns.put(keySeq, rs.getString("PKCOLUMN_NAME"));
    }
    for (String name : order) {
      FkBuilder builder = byName.get(name);
      ObjectNode fk = foreignKeys.addObject();
      fk.put("name", name);
      ArrayNode columns = fk.putArray("columns");
      for (String column : builder.columns.values()) {
        columns.add(column);
      }
      if (builder.referencedSchema != null && !builder.referencedSchema.isBlank()) {
        fk.put("referencedSchema", builder.referencedSchema);
      }
      fk.put("referencedTable", builder.referencedTable == null ? "" : builder.referencedTable);
      ArrayNode refColumns = fk.putArray("referencedColumns");
      for (String column : builder.referencedColumns.values()) {
        refColumns.add(column);
      }
      if (builder.updateRule != null) {
        fk.put("updateRule", builder.updateRule);
      }
      if (builder.deleteRule != null) {
        fk.put("deleteRule", builder.deleteRule);
      }
    }
  }

  private static String ruleName(short rule) {
    if (rule == DatabaseMetaData.importedKeyCascade) return "CASCADE";
    if (rule == DatabaseMetaData.importedKeyRestrict) return "RESTRICT";
    if (rule == DatabaseMetaData.importedKeySetNull) return "SET NULL";
    if (rule == DatabaseMetaData.importedKeySetDefault) return "SET DEFAULT";
    if (rule == DatabaseMetaData.importedKeyNoAction) return "NO ACTION";
    return null;
  }
}
