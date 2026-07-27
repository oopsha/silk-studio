import type { ConnectionDriverId } from "../connection/connectionTypes";

export type ExplainStepKind = "setup" | "main" | "teardown";

export type ExplainStep = {
  sql: string;
  kind: ExplainStepKind;
  /** When true, this step’s result set is shown in the panel. */
  captureResult: boolean;
};

export type ExplainPlan = {
  label: string;
  steps: ExplainStep[];
};

/**
 * Builds driver-specific Explain / Explain Plan steps for a single statement.
 * Multi-step plans (Oracle, SQL Server) run sequentially; teardown always runs in finally.
 */
export function buildExplainPlan(
  driverId: ConnectionDriverId,
  sql: string,
): ExplainPlan {
  const statement = sql.trim();
  if (!statement) {
    return { label: "EXPLAIN", steps: [] };
  }

  if (isAlreadyExplainSql(driverId, statement)) {
    return {
      label: "EXPLAIN",
      steps: [{ sql: statement, kind: "main", captureResult: true }],
    };
  }

  switch (driverId) {
    case "mysql":
    case "mariadb":
      return {
        label: "EXPLAIN",
        steps: [
          {
            sql: `EXPLAIN ${statement}`,
            kind: "main",
            captureResult: true,
          },
        ],
      };
    case "postgresql":
      return {
        label: "EXPLAIN",
        steps: [
          {
            sql: `EXPLAIN (FORMAT TEXT) ${statement}`,
            kind: "main",
            captureResult: true,
          },
        ],
      };
    case "oracle":
      return {
        label: "EXPLAIN PLAN",
        steps: [
          {
            sql: `EXPLAIN PLAN FOR ${statement}`,
            kind: "setup",
            captureResult: false,
          },
          {
            sql: "SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY())",
            kind: "main",
            captureResult: true,
          },
        ],
      };
    case "sqlserver":
      return {
        label: "SHOWPLAN",
        steps: [
          {
            sql: "SET SHOWPLAN_ALL ON",
            kind: "setup",
            captureResult: false,
          },
          {
            sql: statement,
            kind: "main",
            captureResult: true,
          },
          {
            sql: "SET SHOWPLAN_ALL OFF",
            kind: "teardown",
            captureResult: false,
          },
        ],
      };
  }
}

function isAlreadyExplainSql(
  driverId: ConnectionDriverId,
  sql: string,
): boolean {
  const lower = sql.trimStart().toLowerCase();
  if (driverId === "oracle") {
    return lower.startsWith("explain plan");
  }
  if (driverId === "sqlserver") {
    return false;
  }
  return lower.startsWith("explain");
}
