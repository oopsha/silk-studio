import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isQueryResultPayload,
  type QueryResultPayload,
} from "@silk-studio/db-protocol";
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { formatErrorMessage, reportError } from "../formatErrorMessage";
import { bridgeRollback } from "../connection/connectionBridge";
import { ConnectionService } from "../connection/connectionService";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";
import { resolveActiveDriverId } from "../sql/sqlDialect";
import { QueryHistoryService } from "./queryHistoryService";
import type { QueryHistoryStatus } from "./queryHistoryTypes";
import {
  applySqlErrorMarkers,
  clearSqlErrorMarkers,
  type SqlSourceRange,
} from "./sqlErrorMarkers";
import {
  buildLinkedErrorLog,
  type QueryLogPart,
} from "./queryLogNav";
import { buildExplainPlan } from "./sqlExplain";
import { assertReadOnlyQueryAllowed } from "./sqlGuard";
import { stripTrailingSemicolon } from "./sqlExecutable";
import {
  buildQueryResultTabTitle,
  MAX_QUERY_RESULT_TABS,
  type QueryResultTab,
  type QueryResultTabStatus,
} from "./queryResultTab";
import { QueryResultDirtyService } from "./queryResultDirtyService";
import { SqlParameterDialogService } from "./sqlParameterDialogService";
import {
  bindSqlParameters,
  collectSqlParameterFields,
  detectSqlParameterOccurrences,
  type BoundSql,
} from "./sqlParameters";
import {
  ensureExecutionConnection,
  resolveExecutionConnectionId,
} from "./resolveExecutionConnection";
import {
  classifyQueryError,
  resolveScriptQueryTimeoutSec,
} from "./queryErrorKind";

export type QueryExecutionStatus =
  | "idle"
  | "running"
  | "success"
  | "error"
  | "cancelled";

export type QueryExecutionState = {
  status: QueryExecutionStatus;
  /** Status-line / message for the current run or active tab. */
  output: string;
  /** Rich log parts for the active output (Ctrl+click error links). */
  logParts: QueryLogPart[] | null;
  /** Active tab result (convenience mirror). */
  result: QueryResultPayload | null;
  lastSql: string;
  tabs: QueryResultTab[];
  activeTabId: string | null;
};

export type QueryExecuteOptions = {
  /** Buffer range of the executed SQL for Monaco error markers. */
  sourceRange?: SqlSourceRange;
  /** Override SQL stored in history (e.g. original statement for Explain). */
  historySql?: string;
  skipHistory?: boolean;
  /** Explorer Open Data — table results may be editable; views are read-only. */
  relationKind?: "table" | "view";
  /** Override the result tab label (e.g. schema.object from the explorer). */
  tabTitle?: string;
  /**
   * JDBC session key (profile id). When omitted, uses the active editor tab
   * connection binding (MC-D).
   */
  connectionId?: string;
  /**
   * Result-session owner (usually an editor tab id). Open Data uses a synthetic
   * key. When omitted, uses the active editor tab (MC-E).
   */
  ownerId?: string;
};

type QueryExecutionListener = () => void;

type SessionRuntime = {
  runGeneration: number;
  cancelRequested: boolean;
  runTabOrdinal: number;
  activeRunConnectionId: string | null;
};

const INITIAL_STATE: QueryExecutionState = {
  status: "idle",
  output: "",
  logParts: null,
  result: null,
  lastSql: "",
  tabs: [],
  activeTabId: null,
};

const ORPHAN_OWNER_ID = "__orphan__";
const OPEN_DATA_OWNER_PREFIX = "open-data:";

function idleOutput(): string {
  return tKey("app.query.idleOutput");
}

function emptySession(): QueryExecutionState {
  return { ...INITIAL_STATE };
}

function isSyntheticOwnerId(ownerId: string): boolean {
  return (
    ownerId === ORPHAN_OWNER_ID || ownerId.startsWith(OPEN_DATA_OWNER_PREFIX)
  );
}

/** Stable owner key for explorer Open Data result sessions. */
export function buildOpenDataOwnerId(
  profileId: string,
  schemaName: string,
  objectName: string,
): string {
  return `${OPEN_DATA_OWNER_PREFIX}${profileId}:${schemaName}.${objectName}`;
}

class QueryExecutionServiceImpl {
  /** Per editor-tab (or synthetic) result session — MC-E. */
  private readonly sessions = new Map<string, QueryExecutionState>();
  private readonly runtimes = new Map<string, SessionRuntime>();
  /** Which session the panel currently shows. */
  private viewOwnerId: string | null = null;
  /** Last EditorService active tab — used to detect focus changes only. */
  private lastActiveEditorId: string | null = null;
  private readonly listeners = new Set<QueryExecutionListener>();
  private tabSequence = 0;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    EditorService.onDidChange(() => {
      this.syncWithEditorTabs();
    });
    this.syncWithEditorTabs();
  }

  getState(): QueryExecutionState {
    const ownerId = this.viewOwnerId;
    if (!ownerId) {
      return { ...INITIAL_STATE, output: idleOutput() };
    }
    const session = this.sessions.get(ownerId) ?? emptySession();
    if (session.status === "idle" && session.tabs.length === 0) {
      return { ...session, output: idleOutput() };
    }
    return session;
  }

  /** Owner id for the panel's current session (editor tab or open-data). */
  getViewOwnerId(): string | null {
    return this.viewOwnerId;
  }

  isRunning(): boolean {
    return this.getState().status === "running";
  }

  setActiveTab(tabId: string): void {
    const ownerId = this.viewOwnerId;
    if (!ownerId) return;
    const session = this.sessions.get(ownerId);
    if (!session) return;
    const tab = session.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    this.setSessionState(ownerId, {
      ...session,
      status: tab.status === "success" ? "success" : tab.status,
      output: tab.output,
      logParts: tab.logParts ?? null,
      result: tab.result,
      lastSql: tab.sql,
      activeTabId: tab.id,
    });
  }

  closeTab(tabId: string): void {
    const ownerId = this.findOwnerForResultTab(tabId) ?? this.viewOwnerId;
    if (!ownerId) return;
    const session = this.sessions.get(ownerId);
    if (!session) return;

    QueryResultDirtyService.removeTab(tabId);
    const tabs = session.tabs.filter((item) => item.id !== tabId);
    if (tabs.length === session.tabs.length) return;

    if (tabs.length === 0) {
      this.setSessionState(ownerId, {
        status: session.status === "running" ? "running" : "idle",
        output:
          session.status === "running" ? session.output : idleOutput(),
        logParts: null,
        result: null,
        lastSql: session.lastSql,
        tabs: [],
        activeTabId: null,
      });
      return;
    }

    const closingActive = session.activeTabId === tabId;
    let activeTabId = session.activeTabId;
    if (closingActive) {
      const closedIndex = session.tabs.findIndex((item) => item.id === tabId);
      const next =
        tabs[Math.min(closedIndex, tabs.length - 1)] ?? tabs[tabs.length - 1];
      activeTabId = next.id;
    }

    const active = tabs.find((item) => item.id === activeTabId) ?? tabs[0];
    this.setSessionState(ownerId, {
      status: active.status === "success" ? "success" : active.status,
      output: active.output,
      logParts: active.logParts ?? null,
      result: active.result,
      lastSql: active.sql,
      tabs,
      activeTabId: active.id,
    });
  }

  closeAllTabs(): void {
    const ownerId = this.viewOwnerId;
    if (!ownerId) return;
    const session = this.sessions.get(ownerId) ?? emptySession();
    QueryResultDirtyService.removeTabs(session.tabs.map((tab) => tab.id));
    this.setSessionState(ownerId, {
      status: session.status === "running" ? "running" : "idle",
      output: session.status === "running" ? session.output : idleOutput(),
      logParts: null,
      result: null,
      lastSql: session.lastSql,
      tabs: [],
      activeTabId: null,
    });
  }

  /** Execute a single write statement without opening a new result tab. */
  async executeWriteStatement(
    sql: string,
    options?: Pick<QueryExecuteOptions, "connectionId">,
  ): Promise<void> {
    if (!isTauri()) {
      throw new Error("Database writes are available in the desktop app only.");
    }

    const connectionId = resolveExecutionConnectionId(options);
    const readOnly = ConfigurationService.getValue("database.readOnly");
    assertReadOnlyQueryAllowed(sql, readOnly);
    await ensureExecutionConnection(connectionId);

    const payload = await this.invokeQuery(connectionId, sql, readOnly);
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid query result payload from desktop bridge.");
    }

    const record = payload as Record<string, unknown>;
    if (record.kind === "update" || record.kind === "resultSet") {
      return;
    }
    throw new Error("Unexpected response while executing UPDATE.");
  }

  /** Re-run the tab's SELECT and replace its grid data in place. */
  async refreshTabResult(tabId: string): Promise<void> {
    const ownerId = this.findOwnerForResultTab(tabId);
    if (!ownerId) {
      throw new Error("Result tab not found.");
    }
    const session = this.sessions.get(ownerId);
    const tab = session?.tabs.find((item) => item.id === tabId);
    if (!tab || !session) {
      throw new Error("Result tab not found.");
    }

    if (!isTauri()) {
      throw new Error("Refreshing results is available in the desktop app only.");
    }

    const connectionId =
      tab.connectionId?.trim() || resolveExecutionConnectionId();
    const readOnly = ConfigurationService.getValue("database.readOnly");
    assertReadOnlyQueryAllowed(tab.sql, readOnly);
    await ensureExecutionConnection(connectionId);

    const payload = await this.invokeQuery(connectionId, tab.sql, readOnly);
    if (!isQueryResultPayload(payload)) {
      throw new Error("Invalid query result payload from desktop bridge.");
    }

    const tabs = session.tabs.map((item) =>
      item.id === tabId
        ? {
            ...item,
            result: payload,
            output: payload.message || item.output,
          }
        : item,
    );
    const active = tabs.find((item) => item.id === tabId);
    const isActive = session.activeTabId === tabId;

    this.setSessionState(ownerId, {
      ...session,
      tabs,
      result: isActive ? payload : session.result,
      output: isActive ? active?.output ?? session.output : session.output,
      logParts: isActive ? active?.logParts ?? null : session.logParts,
    });
  }

  async execute(sql: string, options?: QueryExecuteOptions): Promise<void> {
    const ownerId = this.resolveOwnerId(options);
    const statement = stripTrailingSemicolon(sql.trim());
    if (!statement) {
      this.patchRunStatus(ownerId, {
        status: "error",
        output: tKey("app.query.emptyQuery"),
        lastSql: sql,
      });
      return;
    }

    await this.executeStatements(
      [{ sql: statement, range: options?.sourceRange }],
      options,
    );
  }

  /**
   * Run one or more statements sequentially. Each statement becomes its own tab
   * for this run only — a new execute replaces prior result tabs for this owner.
   */
  async executeStatements(
    statements: Array<{ sql: string; range?: SqlSourceRange }>,
    options?: QueryExecuteOptions,
  ): Promise<void> {
    const ownerId = this.resolveOwnerId(options);
    const prepared = statements
      .map((item) => ({
        sql: stripTrailingSemicolon(item.sql.trim()),
        range: item.range,
      }))
      .filter((item) => item.sql.length > 0);

    if (prepared.length === 0) {
      this.patchRunStatus(ownerId, {
        status: "error",
        output: tKey("app.query.emptyQuery"),
      });
      return;
    }

    // Fail fast when the tab has no connection target (before parameter prompts).
    let connectionId: string | null =
      options?.connectionId?.trim() ||
      EditorConnectionBindingService.getActiveBinding().profileId?.trim() ||
      null;
    if (isTauri()) {
      connectionId = resolveExecutionConnectionId(options);
    }

    const boundList: Array<{
      sql: string;
      range?: SqlSourceRange;
      bound: BoundSql;
    }> = [];

    for (const item of prepared) {
      const resolved = await this.resolveStatementBinds(item.sql);
      if (resolved === "cancelled") {
        this.patchRunStatus(ownerId, {
          status: "cancelled",
          output: tKey("app.query.parametersCancelled"),
          lastSql: item.sql,
        });
        return;
      }
      boundList.push({ sql: item.sql, range: item.range, bound: resolved });
    }

    const runtime = this.ensureRuntime(ownerId);
    const generation = ++runtime.runGeneration;
    runtime.cancelRequested = false;
    clearSqlErrorMarkers();

    runtime.activeRunConnectionId = connectionId;
    const runOptions: QueryExecuteOptions = {
      ...options,
      ownerId,
      connectionId: connectionId ?? undefined,
    };

    const total = boundList.length;
    this.beginRun(
      ownerId,
      boundList[0].sql,
      total === 1
        ? tKey("app.query.executing")
        : tKey("app.query.executingProgress")
            .replace("{current}", "1")
            .replace("{total}", String(total)),
    );

    try {
      if (!isTauri()) {
        if (!this.isCurrentRun(ownerId, generation)) return;
        for (let index = 0; index < boundList.length; index += 1) {
          if (
            !this.isCurrentRun(ownerId, generation) ||
            runtime.cancelRequested
          ) {
            this.finishCancelled(
              ownerId,
              boundList[index].sql,
              performance.now(),
              runOptions,
            );
            return;
          }
          const item = boundList[index];
          const output = `Desktop-only JDBC execution.\n\nSQL:\n${item.sql}`;
          this.commitTab(ownerId, {
            sql: item.sql,
            output,
            result: null,
            status: "success",
            connectionId: connectionId ?? undefined,
          });
          this.recordHistory(
            ownerId,
            item.sql,
            "success",
            performance.now(),
            output,
            runOptions,
          );
        }
        return;
      }

      await ensureExecutionConnection(connectionId!);
      const readOnly = ConfigurationService.getValue("database.readOnly");

      for (let index = 0; index < boundList.length; index += 1) {
        if (!this.isCurrentRun(ownerId, generation)) {
          return;
        }
        if (runtime.cancelRequested) {
          this.finishCancelled(
            ownerId,
            boundList[index].sql,
            performance.now(),
            runOptions,
          );
          return;
        }

        const item = boundList[index];
        if (total > 1) {
          this.patchRunStatus(ownerId, {
            status: "running",
            output: `Executing ${index + 1}/${total}...`,
            lastSql: item.sql,
          });
        }

        const startedAt = performance.now();
        try {
          assertReadOnlyQueryAllowed(item.sql, readOnly);
          const payload = await this.invokeQuery(
            connectionId!,
            item.bound.sql,
            readOnly,
            item.bound.binds,
          );

          if (!this.isCurrentRun(ownerId, generation)) {
            return;
          }
          if (runtime.cancelRequested) {
            this.finishCancelled(ownerId, item.sql, startedAt, runOptions);
            return;
          }
          if (!isQueryResultPayload(payload)) {
            throw new Error("Invalid query result payload from desktop bridge.");
          }

          this.commitTab(ownerId, {
            sql: item.sql,
            output: payload.message,
            result: payload,
            status: "success",
            relationKind: options?.relationKind,
            title: options?.tabTitle,
            connectionId: connectionId!,
          });
          this.recordHistory(
            ownerId,
            options?.historySql && total === 1
              ? options.historySql
              : item.sql,
            "success",
            startedAt,
            payload.message,
            runOptions,
          );
        } catch (error) {
          if (!this.isCurrentRun(ownerId, generation)) {
            return;
          }
          if (
            runtime.cancelRequested ||
            classifyQueryError(error) === "cancel"
          ) {
            this.finishCancelled(ownerId, item.sql, startedAt, runOptions);
            return;
          }

          const message = this.formatQueryFailureMessage(error);
          const linked = buildLinkedErrorLog(message, item.range ?? null);
          this.commitTab(ownerId, {
            sql: item.sql,
            output: linked.output,
            logParts: linked.logParts,
            result: null,
            status: "error",
            relationKind: options?.relationKind,
            title: options?.tabTitle,
            connectionId: connectionId!,
          });
          this.recordHistory(
            ownerId,
            item.sql,
            "error",
            startedAt,
            message,
            runOptions,
          );
          applySqlErrorMarkers(message, item.range ?? null);
          // Continue remaining statements so N selections still yield N tabs.
        }
      }
    } catch (error) {
      // Connection / setup failure before any statement.
      this.handleRunError(
        ownerId,
        error,
        boundList[0]?.sql ?? prepared[0].sql,
        generation,
        performance.now(),
        {
          ...runOptions,
          sourceRange: boundList[0]?.range ?? prepared[0].range,
        },
      );
    } finally {
      if (this.isCurrentRun(ownerId, generation)) {
        runtime.activeRunConnectionId = null;
      }
    }
  }

  /**
   * Execute Script: run batches/statements sequentially. Result-set payloads open
   * result tabs; update-only / message outcomes are aggregated into one Script log
   * tab (avoids thousands of tabs for GO / DDL scripts).
   */
  async executeScript(
    statements: Array<{ sql: string; range?: SqlSourceRange }>,
    options?: QueryExecuteOptions,
  ): Promise<void> {
    const ownerId = this.resolveOwnerId(options);
    const prepared = statements
      .map((item) => ({
        sql: stripTrailingSemicolon(item.sql.trim()),
        range: item.range,
      }))
      .filter((item) => item.sql.length > 0);

    if (prepared.length === 0) {
      this.patchRunStatus(ownerId, {
        status: "error",
        output: tKey("app.query.emptyQuery"),
      });
      return;
    }

    let connectionId: string | null =
      options?.connectionId?.trim() ||
      EditorConnectionBindingService.getActiveBinding().profileId?.trim() ||
      null;
    if (isTauri()) {
      connectionId = resolveExecutionConnectionId(options);
    }

    const boundList: Array<{
      sql: string;
      range?: SqlSourceRange;
      bound: BoundSql;
    }> = [];

    for (const item of prepared) {
      const resolved = await this.resolveStatementBinds(item.sql);
      if (resolved === "cancelled") {
        this.patchRunStatus(ownerId, {
          status: "cancelled",
          output: tKey("app.query.parametersCancelled"),
          lastSql: item.sql,
        });
        return;
      }
      boundList.push({ sql: item.sql, range: item.range, bound: resolved });
    }

    const runtime = this.ensureRuntime(ownerId);
    const generation = ++runtime.runGeneration;
    runtime.cancelRequested = false;
    clearSqlErrorMarkers();

    runtime.activeRunConnectionId = connectionId;
    const runOptions: QueryExecuteOptions = {
      ...options,
      ownerId,
      connectionId: connectionId ?? undefined,
    };

    const total = boundList.length;
    const scriptSql = boundList.map((item) => item.sql).join("\nGO\n");
    const historySql =
      options?.historySql ??
      (scriptSql.length > 2000
        ? `${scriptSql.slice(0, 2000)}\n/* … */`
        : scriptSql);

    this.beginRun(
      ownerId,
      boundList[0].sql,
      total === 1
        ? tKey("app.query.executingScript")
        : tKey("app.query.executingScriptProgress")
            .replace("{current}", "1")
            .replace("{total}", String(total)),
    );

    const logLines: string[] = [];
    const metaLines: string[] = [];
    let successCount = 0;
    let errorCount = 0;
    let resultSetCount = 0;
    let lastErrorRange: SqlSourceRange | null = null;
    let lastErrorMessage = "";
    let linkedError: ReturnType<typeof buildLinkedErrorLog> | null = null;
    const startedAt = performance.now();

    const appendLog = (line: string) => {
      logLines.push(line);
    };

    const appendMeta = (line: string) => {
      metaLines.push(line);
    };

    const buildPrefaceLines = (): string[] => {
      const lines: string[] = [];
      if (successCount > 0) {
        lines.push(
          tKey("app.query.scriptSuccessSummary").replace(
            "{count}",
            String(successCount),
          ),
        );
      }
      if (resultSetCount > 0) {
        lines.push(
          tKey("app.query.scriptResultSetSummary").replace(
            "{count}",
            String(resultSetCount),
          ),
        );
      }
      lines.push(...metaLines);
      return lines;
    };

    const buildScriptLogLines = (): string[] => {
      const lines = buildPrefaceLines();
      if (logLines.length > 0) {
        if (lines.length > 0) {
          lines.push("");
        }
        lines.push(...logLines);
      }
      return lines;
    };

    const buildScriptLogParts = (): QueryLogPart[] | null => {
      if (!linkedError) return null;
      const preface = buildPrefaceLines();
      const parts: QueryLogPart[] = [];
      if (preface.length > 0) {
        parts.push({ kind: "text", text: `${preface.join("\n")}\n\n` });
      }
      parts.push(...linkedError.logParts);
      return parts;
    };

    try {
      if (!isTauri()) {
        if (!this.isCurrentRun(ownerId, generation)) return;
        successCount = boundList.length;
        this.commitScriptOutcome(ownerId, {
          scriptSql,
          logLines: buildScriptLogLines(),
          successCount,
          errorCount,
          plannedTotal: total,
          connectionId: connectionId ?? undefined,
        });
        this.recordHistory(
          ownerId,
          historySql,
          "success",
          startedAt,
          buildScriptLogLines().join("\n"),
          runOptions,
        );
        return;
      }

      await ensureExecutionConnection(connectionId!);
      const readOnly = ConfigurationService.getValue("database.readOnly");
      const configuredTimeout = ConfigurationService.getValue(
        "database.queryTimeoutSec",
      );
      const scriptTimeoutSec =
        resolveScriptQueryTimeoutSec(configuredTimeout);

      for (let index = 0; index < boundList.length; index += 1) {
        if (!this.isCurrentRun(ownerId, generation)) {
          return;
        }
        if (runtime.cancelRequested) {
          this.finishCancelled(ownerId, boundList[index].sql, startedAt, {
            ...runOptions,
            historySql,
          });
          return;
        }

        const item = boundList[index];
        if (total > 1) {
          this.patchRunStatus(ownerId, {
            status: "running",
            output: tKey("app.query.executingScriptProgress")
              .replace("{current}", String(index + 1))
              .replace("{total}", String(total)),
            lastSql: item.sql,
          });
        }

        try {
          assertReadOnlyQueryAllowed(item.sql, readOnly);
          const payload = await this.invokeQuery(
            connectionId!,
            item.bound.sql,
            readOnly,
            item.bound.binds,
            scriptTimeoutSec,
          );

          if (!this.isCurrentRun(ownerId, generation)) {
            return;
          }
          if (runtime.cancelRequested) {
            this.finishCancelled(ownerId, item.sql, startedAt, {
              ...runOptions,
              historySql,
            });
            return;
          }
          if (!isQueryResultPayload(payload)) {
            throw new Error("Invalid query result payload from desktop bridge.");
          }

          successCount += 1;
          if (payload.kind === "resultSet") {
            resultSetCount += 1;
            this.commitTab(ownerId, {
              sql: item.sql,
              output: payload.message,
              result: payload,
              status: "success",
              connectionId: connectionId!,
            });
          }
          // Update-only successes are summarized at the end (no per-batch OK lines).
        } catch (error) {
          if (!this.isCurrentRun(ownerId, generation)) {
            return;
          }
          if (
            runtime.cancelRequested ||
            classifyQueryError(error) === "cancel"
          ) {
            this.finishCancelled(ownerId, item.sql, startedAt, {
              ...runOptions,
              historySql,
            });
            return;
          }

          const message = this.formatQueryFailureMessage(
            error,
            scriptTimeoutSec,
          );
          errorCount += 1;
          lastErrorRange = item.range ?? null;
          lastErrorMessage = message;
          linkedError = buildLinkedErrorLog(message, item.range ?? null, {
            batchIndex: index + 1,
            batchTotal: total,
          });
          appendLog(linkedError.output);

          const remaining = total - (index + 1);
          appendMeta(
            remaining > 0
              ? tKey("app.query.scriptStoppedOnError").replace(
                  "{count}",
                  String(remaining),
                )
              : tKey("app.query.scriptStoppedOnErrorLast"),
          );

          // Stop + rollback (DBeaver default): do not continue remaining batches.
          try {
            const rollback = await bridgeRollback(connectionId!);
            if (rollback.rolledBack) {
              appendMeta(tKey("app.query.scriptRolledBack"));
            } else {
              appendMeta(tKey("app.query.scriptRollbackSkippedAutoCommit"));
            }
          } catch (rollbackError) {
            appendMeta(
              tKey("app.query.scriptRollbackFailed").replace(
                "{message}",
                formatErrorMessage(rollbackError, String(rollbackError)),
              ),
            );
          }
          break;
        }
      }

      if (!this.isCurrentRun(ownerId, generation)) {
        return;
      }

      const status: QueryResultTabStatus =
        errorCount > 0 ? "error" : "success";
      const scriptLog = buildScriptLogLines();

      this.commitScriptOutcome(ownerId, {
        scriptSql,
        logLines: scriptLog,
        logParts: buildScriptLogParts(),
        successCount,
        errorCount,
        plannedTotal: total,
        connectionId: connectionId ?? undefined,
        status,
      });

      if (errorCount > 0 && lastErrorMessage) {
        applySqlErrorMarkers(lastErrorMessage, lastErrorRange, {
          reveal: true,
        });
      }

      this.recordHistory(
        ownerId,
        historySql,
        errorCount > 0 ? "error" : "success",
        startedAt,
        scriptLog.join("\n"),
        runOptions,
      );
    } catch (error) {
      this.handleRunError(
        ownerId,
        error,
        boundList[0]?.sql ?? prepared[0].sql,
        generation,
        startedAt,
        {
          ...runOptions,
          historySql,
          sourceRange: boundList[0]?.range ?? prepared[0].range,
        },
      );
    } finally {
      if (this.isCurrentRun(ownerId, generation)) {
        runtime.activeRunConnectionId = null;
      }
    }
  }

  /**
   * Runs a driver-specific Explain / Explain Plan for the given statement and
   * shows the plan result in the panel (same result grid as normal execute).
   */
  async explain(sql: string, options?: QueryExecuteOptions): Promise<void> {
    const ownerId = this.resolveOwnerId(options);
    const statement = stripTrailingSemicolon(sql.trim());
    if (!statement) {
      this.patchRunStatus(ownerId, {
        status: "error",
        output: tKey("app.query.emptyExplain"),
        lastSql: sql,
      });
      return;
    }

    const bound = await this.resolveStatementBinds(statement);
    if (bound === "cancelled") {
      this.patchRunStatus(ownerId, {
        status: "cancelled",
        output: tKey("app.query.parametersCancelled"),
        lastSql: statement,
      });
      return;
    }

    const connectionId = isTauri()
      ? resolveExecutionConnectionId(options)
      : options?.connectionId?.trim() ||
        EditorConnectionBindingService.getActiveBinding().profileId?.trim() ||
        null;
    const runOptions: QueryExecuteOptions = {
      ...options,
      ownerId,
      connectionId: connectionId ?? undefined,
    };

    const driverId = resolveActiveDriverId(connectionId);
    const plan = buildExplainPlan(driverId, bound.sql);
    if (plan.steps.length === 0) {
      this.patchRunStatus(ownerId, {
        status: "error",
        output: tKey("app.query.nothingToExplain"),
        lastSql: statement,
      });
      return;
    }

    const runtime = this.ensureRuntime(ownerId);
    const generation = ++runtime.runGeneration;
    runtime.cancelRequested = false;
    runtime.activeRunConnectionId = connectionId;
    const startedAt = performance.now();
    clearSqlErrorMarkers();

    const historySql = options?.historySql ?? `${plan.label}\n${statement}`;
    const displaySql =
      plan.steps.find((step) => step.captureResult)?.sql ?? statement;

    this.beginRun(ownerId, displaySql, `Running ${plan.label}...`);

    const teardownSql =
      plan.steps.find((step) => step.kind === "teardown")?.sql ?? null;
    let captured: QueryResultPayload | null = null;
    let capturedMessage = "";
    /** SQL Server SHOWPLAN was turned on — must restore even on failure. */
    let showplanArmed = false;

    try {
      if (!isTauri()) {
        if (!this.isCurrentRun(ownerId, generation)) return;
        const preview = plan.steps
          .filter((step) => step.kind !== "teardown")
          .map((step) => step.sql)
          .join("\n\n");
        const output = `Desktop-only JDBC explain.\n\n${plan.label} steps:\n${preview}`;
        this.commitTab(ownerId, {
          sql: displaySql,
          output,
          result: null,
          status: "success",
          connectionId: connectionId ?? undefined,
        });
        this.recordHistory(
          ownerId,
          historySql,
          "success",
          startedAt,
          output,
          runOptions,
        );
        return;
      }

      await ensureExecutionConnection(connectionId!);

      for (const step of plan.steps) {
        if (step.kind === "teardown") {
          continue;
        }

        if (
          runtime.cancelRequested ||
          !this.isCurrentRun(ownerId, generation)
        ) {
          break;
        }

        // Explain does not execute DML (SHOWPLAN / EXPLAIN PLAN). Always talk to the
        // agent with readOnly=false so Oracle can write PLAN_TABLE and SQL Server can
        // accept subject DML under SHOWPLAN. Frontend still blocks accidental writes
        // for normal execute via assertReadOnlyQueryAllowed.
        const stepBinds =
          bound.binds.length > 0 &&
          (step.sql === bound.sql || step.sql.endsWith(bound.sql))
            ? bound.binds
            : undefined;
        const payload = await this.invokeQuery(
          connectionId!,
          step.sql,
          false,
          stepBinds,
        );

        if (step.kind === "setup" && driverId === "sqlserver") {
          showplanArmed = true;
        }

        if (!this.isCurrentRun(ownerId, generation)) {
          return;
        }

        if (runtime.cancelRequested) {
          this.finishCancelled(ownerId, displaySql, startedAt, {
            ...runOptions,
            historySql,
          });
          return;
        }

        if (!isQueryResultPayload(payload)) {
          throw new Error("Invalid query result payload from desktop bridge.");
        }

        if (step.captureResult) {
          captured = payload;
          capturedMessage = payload.message;
        }
      }

      if (!this.isCurrentRun(ownerId, generation)) {
        return;
      }

      if (runtime.cancelRequested) {
        this.finishCancelled(ownerId, displaySql, startedAt, {
          ...runOptions,
          historySql,
        });
        return;
      }

      if (!captured) {
        throw new Error("Explain completed without a plan result.");
      }

      const output = capturedMessage || `${plan.label} completed.`;
      this.commitTab(ownerId, {
        sql: displaySql,
        output,
        result: captured,
        status: "success",
        connectionId: connectionId!,
      });
      this.recordHistory(
        ownerId,
        historySql,
        "success",
        startedAt,
        output,
        runOptions,
      );
    } catch (error) {
      this.handleRunError(ownerId, error, displaySql, generation, startedAt, {
        ...runOptions,
        historySql,
      });
    } finally {
      if (showplanArmed && teardownSql && isTauri() && connectionId) {
        try {
          await this.invokeQuery(connectionId, teardownSql, false);
        } catch (teardownError) {
          console.warn(
            "[silk.query.explain] failed to restore SHOWPLAN session state",
            teardownError,
          );
        }
      }
      if (this.isCurrentRun(ownerId, generation)) {
        runtime.activeRunConnectionId = null;
      }
    }
  }

  async cancel(): Promise<void> {
    const ownerId = this.viewOwnerId;
    if (!ownerId) return;
    const session = this.sessions.get(ownerId);
    if (!session || session.status !== "running") {
      return;
    }

    const runtime = this.ensureRuntime(ownerId);
    runtime.cancelRequested = true;
    this.patchRunStatus(ownerId, {
      status: "running",
      output: tKey("app.query.cancelling"),
    });

    if (!isTauri()) {
      runtime.runGeneration += 1;
      this.setSessionState(ownerId, {
        ...session,
        status: "cancelled",
        output: tKey("app.query.cancelled"),
        logParts: null,
      });
      return;
    }

    try {
      const connectionId = runtime.activeRunConnectionId;
      if (!connectionId) {
        console.warn("[silk.query.cancel] no active run connection");
        return;
      }
      await invoke("query_cancel", { connectionId });
    } catch (error) {
      // Cancel RPC failed — still mark cancelled when the execute promise settles.
      console.warn("[silk.query.cancel] bridge cancel failed", error);
    }
  }

  onDidChange(listener: QueryExecutionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private resolveOwnerId(options?: QueryExecuteOptions): string {
    const explicit = options?.ownerId?.trim();
    if (explicit) return explicit;
    const active = EditorService.getActiveTabId();
    if (active) return active;
    return ORPHAN_OWNER_ID;
  }

  private ensureRuntime(ownerId: string): SessionRuntime {
    let runtime = this.runtimes.get(ownerId);
    if (!runtime) {
      runtime = {
        runGeneration: 0,
        cancelRequested: false,
        runTabOrdinal: 0,
        activeRunConnectionId: null,
      };
      this.runtimes.set(ownerId, runtime);
    }
    return runtime;
  }

  private findOwnerForResultTab(tabId: string): string | null {
    for (const [ownerId, session] of this.sessions) {
      if (session.tabs.some((tab) => tab.id === tabId)) {
        return ownerId;
      }
    }
    return null;
  }

  private beginRun(ownerId: string, sql: string, output: string): void {
    const prev = this.sessions.get(ownerId);
    if (prev?.tabs.length) {
      QueryResultDirtyService.removeTabs(prev.tabs.map((tab) => tab.id));
    }
    const runtime = this.ensureRuntime(ownerId);
    runtime.runTabOrdinal = 0;
    this.viewOwnerId = ownerId;
    this.setSessionState(ownerId, {
      status: "running",
      output,
      logParts: null,
      lastSql: sql,
      result: null,
      tabs: [],
      activeTabId: null,
    });
  }

  private commitTab(
    ownerId: string,
    input: {
      sql: string;
      output: string;
      logParts?: QueryLogPart[] | null;
      result: QueryResultPayload | null;
      status: QueryResultTabStatus;
      relationKind?: "table" | "view";
      title?: string;
      connectionId?: string;
    },
  ): void {
    const runtime = this.ensureRuntime(ownerId);
    const session = this.sessions.get(ownerId) ?? emptySession();
    runtime.runTabOrdinal += 1;
    this.tabSequence += 1;
    const tab: QueryResultTab = {
      id: `result-${this.tabSequence}-${Date.now()}`,
      title:
        input.title ??
        buildQueryResultTabTitle(
          input.sql,
          input.result,
          runtime.runTabOrdinal,
        ),
      sql: input.sql,
      status: input.status,
      output: input.output,
      logParts: input.logParts ?? undefined,
      result: input.result,
      createdAt: Date.now(),
      relationKind: input.relationKind,
      connectionId: input.connectionId,
    };

    let tabs = [...session.tabs, tab];
    if (tabs.length > MAX_QUERY_RESULT_TABS) {
      const dropped = tabs.slice(0, tabs.length - MAX_QUERY_RESULT_TABS);
      QueryResultDirtyService.removeTabs(dropped.map((item) => item.id));
      tabs = tabs.slice(tabs.length - MAX_QUERY_RESULT_TABS);
    }

    this.setSessionState(ownerId, {
      status: input.status === "success" ? "success" : input.status,
      output: input.output,
      logParts: input.logParts ?? null,
      result: input.result,
      lastSql: input.sql,
      tabs,
      activeTabId: tab.id,
    });
  }

  /** Aggregate script messages into one Script tab (plus any prior result-set tabs). */
  private commitScriptOutcome(
    ownerId: string,
    input: {
      scriptSql: string;
      logLines: string[];
      logParts?: QueryLogPart[] | null;
      successCount: number;
      errorCount: number;
      plannedTotal?: number;
      connectionId?: string;
      status?: QueryResultTabStatus;
    },
  ): void {
    const executed = input.successCount + input.errorCount;
    const planned = input.plannedTotal ?? executed;
    const summary = tKey("app.query.scriptSummary")
      .replace("{success}", String(input.successCount))
      .replace("{error}", String(input.errorCount))
      .replace("{executed}", String(executed))
      .replace("{planned}", String(planned));

    const detailParts = input.logParts ?? null;
    const detailText =
      input.logLines.length > 0 ? input.logLines.join("\n") : "";
    const body =
      detailText.length > 0 ? `${summary}\n\n${detailText}` : summary;

    let logParts: QueryLogPart[] | null = null;
    if (detailParts && detailParts.length > 0) {
      logParts = [
        {
          kind: "text",
          text: detailText.length > 0 ? `${summary}\n\n` : summary,
        },
        ...detailParts,
      ];
    }

    const status: QueryResultTabStatus =
      input.status ?? (input.errorCount > 0 ? "error" : "success");

    this.commitTab(ownerId, {
      sql: input.scriptSql,
      output: body,
      logParts,
      result: null,
      status,
      title: tKey("app.query.scriptTabTitle"),
      connectionId: input.connectionId,
    });
  }

  private patchRunStatus(
    ownerId: string,
    patch: {
      status: QueryExecutionStatus;
      output: string;
      lastSql?: string;
    },
  ): void {
    this.viewOwnerId = ownerId;
    const session = this.sessions.get(ownerId) ?? emptySession();
    this.setSessionState(ownerId, {
      ...session,
      status: patch.status,
      output: patch.output,
      logParts: patch.status === "running" ? null : session.logParts,
      lastSql: patch.lastSql ?? session.lastSql,
    });
  }

  private async resolveStatementBinds(
    sql: string,
  ): Promise<BoundSql | "cancelled"> {
    const options = {
      anonymousEnabled: ConfigurationService.getValue(
        "sql.parameters.anonymousEnabled",
      ),
      namedEnabled: ConfigurationService.getValue(
        "sql.parameters.namedEnabled",
      ),
    };
    const occurrences = detectSqlParameterOccurrences(sql, options);
    if (occurrences.length === 0) {
      return { sql, binds: [] };
    }

    const fields = collectSqlParameterFields(occurrences);
    const result = await SqlParameterDialogService.open(fields);

    if (!result.confirmed) {
      return "cancelled";
    }

    return bindSqlParameters(sql, occurrences, result.values);
  }

  private async invokeQuery(
    connectionId: string,
    sql: string,
    readOnly: boolean,
    binds?: Array<string | null>,
    queryTimeoutSecOverride?: number,
  ): Promise<unknown> {
    const maxRows = ConfigurationService.getValue("queryResult.maxRows");
    const queryTimeoutSec =
      queryTimeoutSecOverride !== undefined
        ? queryTimeoutSecOverride
        : ConfigurationService.getValue("database.queryTimeoutSec");
    const autoCommit = ConfigurationService.getValue("database.autoCommit");
    return invoke<unknown>("query_execute", {
      connectionId,
      sql,
      maxRows,
      queryTimeoutSec,
      autoCommit,
      readOnly,
      binds: binds && binds.length > 0 ? binds : null,
    });
  }

  private formatQueryFailureMessage(
    error: unknown,
    timeoutSec?: number,
  ): string {
    const kind = classifyQueryError(error);
    if (kind === "timeout") {
      const configured =
        timeoutSec ??
        ConfigurationService.getValue("database.queryTimeoutSec");
      const detail = formatErrorMessage(error, "");
      const headline =
        configured > 0
          ? tKey("app.query.timedOut")
              .replace("{seconds}", String(configured))
          : tKey("app.query.timedOutUnlimited");
      return detail ? `${headline}\n${detail}` : headline;
    }

    return reportError(
      error,
      "query.execute",
      tKey("app.query.executeFailed"),
    );
  }

  private handleRunError(
    ownerId: string,
    error: unknown,
    statement: string,
    generation: number,
    startedAt: number,
    options?: QueryExecuteOptions,
  ): void {
    if (!this.isCurrentRun(ownerId, generation)) {
      return;
    }

    const runtime = this.ensureRuntime(ownerId);
    if (
      runtime.cancelRequested ||
      classifyQueryError(error) === "cancel"
    ) {
      this.finishCancelled(ownerId, statement, startedAt, options);
      return;
    }

    const message = this.formatQueryFailureMessage(error);
    const linked = buildLinkedErrorLog(
      message,
      options?.sourceRange ?? null,
    );
    const session = this.sessions.get(ownerId) ?? emptySession();
    this.setSessionState(ownerId, {
      ...session,
      status: "error",
      output: linked.output,
      logParts: linked.logParts,
      lastSql: statement,
    });
    this.recordHistory(
      ownerId,
      options?.historySql ?? statement,
      "error",
      startedAt,
      message,
      options,
    );
    applySqlErrorMarkers(message, options?.sourceRange ?? null);
  }

  private finishCancelled(
    ownerId: string,
    statement: string,
    startedAt: number,
    options?: QueryExecuteOptions,
  ): void {
    const session = this.sessions.get(ownerId) ?? emptySession();
    this.setSessionState(ownerId, {
      ...session,
      status: "cancelled",
      output: tKey("app.query.cancelled"),
      logParts: null,
      lastSql: statement,
    });
    this.recordHistory(
      ownerId,
      options?.historySql ?? statement,
      "cancelled",
      startedAt,
      tKey("app.query.cancelled"),
      options,
    );
  }

  private recordHistory(
    ownerId: string,
    sql: string,
    status: QueryHistoryStatus,
    startedAt: number,
    summary: string,
    options?: QueryExecuteOptions,
  ): void {
    if (options?.skipHistory) return;

    const runtime = this.runtimes.get(ownerId);
    const connectionId =
      options?.connectionId?.trim() ||
      runtime?.activeRunConnectionId ||
      EditorConnectionBindingService.getActiveBinding().profileId?.trim() ||
      null;
    const profile = connectionId
      ? ConnectionService.getProfile(connectionId)
      : (ConnectionService.getConnectedProfile() ??
        ConnectionService.getActiveProfile());
    QueryHistoryService.record({
      sql,
      status,
      durationMs: performance.now() - startedAt,
      connectionProfileId: profile?.id ?? connectionId,
      connectionName: profile?.name ?? null,
      driverId: profile?.driverId ?? null,
      summary,
    });
  }

  private isCurrentRun(ownerId: string, generation: number): boolean {
    return this.ensureRuntime(ownerId).runGeneration === generation;
  }

  private setSessionState(ownerId: string, next: QueryExecutionState): void {
    this.sessions.set(ownerId, next);
    this.fireDidChange();
  }

  private discardSession(ownerId: string): void {
    const session = this.sessions.get(ownerId);
    if (session?.tabs.length) {
      QueryResultDirtyService.removeTabs(session.tabs.map((tab) => tab.id));
    }

    const runtime = this.runtimes.get(ownerId);
    if (runtime && session?.status === "running") {
      runtime.cancelRequested = true;
      runtime.runGeneration += 1;
      const connectionId = runtime.activeRunConnectionId;
      if (connectionId && isTauri()) {
        void invoke("query_cancel", { connectionId }).catch((error) => {
          console.warn(
            "[silk.query] cancel on editor close failed",
            error,
          );
        });
      }
    }

    this.sessions.delete(ownerId);
    this.runtimes.delete(ownerId);
  }

  private syncWithEditorTabs(): void {
    const tabs = EditorService.getTabs();
    const liveIds = new Set(tabs.map((tab) => tab.id));
    let changed = false;

    for (const ownerId of [...this.sessions.keys()]) {
      if (isSyntheticOwnerId(ownerId)) continue;
      if (!liveIds.has(ownerId)) {
        this.discardSession(ownerId);
        changed = true;
      }
    }

    const activeId = EditorService.getActiveTabId();
    if (activeId !== this.lastActiveEditorId) {
      this.lastActiveEditorId = activeId;
      if (activeId) {
        if (this.viewOwnerId !== activeId) {
          this.viewOwnerId = activeId;
          changed = true;
        }
      } else if (
        this.viewOwnerId &&
        !isSyntheticOwnerId(this.viewOwnerId)
      ) {
        this.viewOwnerId = null;
        changed = true;
      }
    }

    if (changed) {
      this.fireDidChange();
    }
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const QueryExecutionService = new QueryExecutionServiceImpl();
