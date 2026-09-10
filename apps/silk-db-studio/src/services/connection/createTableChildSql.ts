import type { ConnectionDriverId } from "./connectionTypes";
import { formatTableReference, quoteIdentifier } from "../query/sqlLiteral";

export type CreateTableChildTarget = {
  schemaName: string;
  tableName: string;
  catalogName?: string | null;
};

function tableRef(driverId: ConnectionDriverId, target: CreateTableChildTarget): string {
  return formatTableReference(
    target.schemaName,
    target.tableName,
    driverId,
    target.catalogName,
  );
}

export function buildCreateIndexSql(
  driverId: ConnectionDriverId,
  target: CreateTableChildTarget,
  firstColumn: string,
): string {
  const indexName = `${target.tableName}_IDX`;
  return [
    `CREATE INDEX ${quoteIdentifier(indexName, driverId)}`,
    `ON ${tableRef(driverId, target)} (${quoteIdentifier(firstColumn, driverId)});`,
  ].join("\n");
}

export function buildCreateTriggerSql(
  driverId: ConnectionDriverId,
  target: CreateTableChildTarget,
): string {
  const triggerName = quoteIdentifier(`${target.tableName}_TRG_INSERT`, driverId);
  const table = tableRef(driverId, target);

  switch (driverId) {
    case "sqlserver":
      return [
        `CREATE TRIGGER ${triggerName}`,
        `ON ${table}`,
        "AFTER INSERT",
        "AS",
        "BEGIN",
        "  SET NOCOUNT ON;",
        "END;",
      ].join("\n");
    case "oracle":
      return [
        `CREATE OR REPLACE TRIGGER ${triggerName}`,
        `BEFORE INSERT ON ${table}`,
        "FOR EACH ROW",
        "BEGIN",
        "  NULL;",
        "END;",
        "/",
      ].join("\n");
    case "postgresql": {
      const functionName = quoteIdentifier(`${target.tableName}_TRG_INSERT_FN`, driverId);
      return [
        `CREATE OR REPLACE FUNCTION ${quoteIdentifier(target.schemaName, driverId)}.${functionName}()`,
        "RETURNS trigger",
        "LANGUAGE plpgsql",
        "AS $$",
        "BEGIN",
        "  RETURN NEW;",
        "END;",
        "$$;",
        "",
        `CREATE TRIGGER ${triggerName}`,
        `BEFORE INSERT ON ${table}`,
        "FOR EACH ROW",
        `EXECUTE FUNCTION ${quoteIdentifier(target.schemaName, driverId)}.${functionName}();`,
      ].join("\n");
    }
    case "mysql":
    case "mariadb":
      return [
        "DELIMITER //",
        `CREATE TRIGGER ${triggerName}`,
        `BEFORE INSERT ON ${table}`,
        "FOR EACH ROW",
        "BEGIN",
        "  -- Add trigger statements here.",
        "END//",
        "DELIMITER ;",
      ].join("\n");
    case "sqlite":
      return [
        `CREATE TRIGGER ${triggerName}`,
        `AFTER INSERT ON ${table}`,
        "BEGIN",
        "  SELECT 1;",
        "END;",
      ].join("\n");
  }
}
