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
 * Shared helper for {@link DbDialect#collectTableReferences} — wraps the driver-generic {@link
 * DatabaseMetaData#getExportedKeys}, the mirror image of {@link MetadataForeignKeys}'s {@code
 * getImportedKeys}. Object Editor "References" section: which *other* tables point at this one,
 * as opposed to "Foreign Keys" (this table pointing at others).
 */
final class MetadataReferences {
  private MetadataReferences() {}

  private static final class RefBuilder {
    String referencingSchema;
    String referencingTable;
    String updateRule;
    String deleteRule;
    final TreeMap<Integer, String> columns = new TreeMap<>();
    final TreeMap<Integer, String> referencingColumns = new TreeMap<>();
  }

  static void appendFromResultSet(ResultSet rs, ArrayNode references) throws SQLException {
    Map<String, RefBuilder> byName = new LinkedHashMap<>();
    List<String> order = new ArrayList<>();
    while (rs.next()) {
      String fkColumn = rs.getString("FKCOLUMN_NAME");
      if (fkColumn == null || fkColumn.isBlank()) {
        continue;
      }
      int keySeq = rs.getInt("KEY_SEQ");
      String fkTable = rs.getString("FKTABLE_NAME");
      String name = rs.getString("FK_NAME");
      if (name == null || name.isBlank()) {
        name = "fk_" + (fkTable == null ? "unknown" : fkTable);
      }
      RefBuilder builder = byName.get(name);
      if (builder == null) {
        builder = new RefBuilder();
        builder.referencingSchema = rs.getString("FKTABLE_SCHEM");
        builder.referencingTable = fkTable;
        builder.updateRule = ruleName(rs.getShort("UPDATE_RULE"));
        builder.deleteRule = ruleName(rs.getShort("DELETE_RULE"));
        byName.put(name, builder);
        order.add(name);
      }
      builder.columns.put(keySeq, rs.getString("PKCOLUMN_NAME"));
      builder.referencingColumns.put(keySeq, fkColumn);
    }
    for (String name : order) {
      RefBuilder builder = byName.get(name);
      ObjectNode ref = references.addObject();
      ref.put("name", name);
      if (builder.referencingSchema != null && !builder.referencingSchema.isBlank()) {
        ref.put("referencingSchema", builder.referencingSchema);
      }
      ref.put(
          "referencingTable", builder.referencingTable == null ? "" : builder.referencingTable);
      ArrayNode columns = ref.putArray("columns");
      for (String column : builder.columns.values()) {
        columns.add(column);
      }
      ArrayNode referencingColumns = ref.putArray("referencingColumns");
      for (String column : builder.referencingColumns.values()) {
        referencingColumns.add(column);
      }
      if (builder.updateRule != null) {
        ref.put("updateRule", builder.updateRule);
      }
      if (builder.deleteRule != null) {
        ref.put("deleteRule", builder.deleteRule);
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
