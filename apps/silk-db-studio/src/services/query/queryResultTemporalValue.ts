import type { ConnectionDriverId } from "../connection/connectionTypes";

/** Internal grid value meaning “evaluate the database server's current time when saving”. */
export const CURRENT_TIMESTAMP_VALUE = "__SILK_CURRENT_TIMESTAMP__";

export function isCurrentTimestampValue(value: string | null | undefined): boolean {
  return value === CURRENT_TIMESTAMP_VALUE;
}

export function currentTemporalSql(driverId: ConnectionDriverId, jdbcType?: number): string {
  const isDate = jdbcType === 91;
  const isTime = jdbcType === 92;
  switch (driverId) {
    case "oracle":
      return isDate ? "SYSDATE" : "SYSTIMESTAMP";
    case "sqlserver":
      return isTime ? "CONVERT(time, SYSDATETIME())" : isDate ? "CONVERT(date, GETDATE())" : "SYSDATETIME()";
    case "postgresql":
      return isTime ? "CURRENT_TIME" : isDate ? "CURRENT_DATE" : "CURRENT_TIMESTAMP";
    case "mysql":
    case "mariadb":
      return isTime ? "CURRENT_TIME" : isDate ? "CURRENT_DATE" : "CURRENT_TIMESTAMP";
    case "sqlite":
      return isTime ? "CURRENT_TIME" : isDate ? "CURRENT_DATE" : "CURRENT_TIMESTAMP";
  }
}
