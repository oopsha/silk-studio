import "./Panel.css";
import { useRef, type KeyboardEvent } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";
import { QueryExecutionService } from "../../../services/query/queryExecutionService";
import { truncateSqlLabel } from "../../../services/query/queryResultTab";
import { useQueryExecutionState } from "../../../services/query/useQueryExecutionState";
import QueryResultGrid from "./QueryResultGrid";

function Panel() {
  const { t } = useI18n();
  const queryState = useQueryExecutionState();
  const layout = useLayoutState();
  const logPreRef = useRef<HTMLPreElement | null>(null);
  const isRunning = queryState.status === "running";
  const showErrorOrCancel =
    queryState.status === "error" || queryState.status === "cancelled";
  const activeTab =
    queryState.tabs.find((tab) => tab.id === queryState.activeTabId) ?? null;

  const gridResult =
    !showErrorOrCancel &&
    activeTab?.result?.kind === "resultSet" &&
    activeTab.result.columns.length > 0
      ? activeTab.result
      : null;

  const logText = showErrorOrCancel
    ? queryState.output
    : (activeTab?.output ?? queryState.output);
  const showLog =
    !gridResult &&
    Boolean(logText?.trim()) &&
    (Boolean(activeTab) || showErrorOrCancel);

  const movePanelLabel =
    layout.panelPosition === "bottom"
      ? t("workbench.commands.movePanelRight")
      : t("workbench.commands.movePanelBottom");
  const maximizeLabel = layout.panelMaximized
    ? t("workbench.commands.restorePanel")
    : t("workbench.commands.maximizePanel");

  async function copyLog() {
    const pre = logPreRef.current;
    const selection = window.getSelection();
    const selected =
      pre &&
      selection &&
      selection.rangeCount > 0 &&
      pre.contains(selection.anchorNode) &&
      !selection.isCollapsed
        ? selection.toString()
        : "";
    const text = selected || logText || "";
    if (!text.trim()) {
      AppNotificationService.show(t("app.query.nothingToCopy"), "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      AppNotificationService.show(t("app.query.copiedLog"), "success");
    } catch (error) {
      console.warn("[panel] copy log failed", error);
      AppNotificationService.show(t("app.query.copyFailed"), "error");
    }
  }

  function handleLogKeyDown(event: KeyboardEvent<HTMLPreElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c") {
      return;
    }
    // Let the browser copy a non-empty selection; otherwise copy the whole log.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }
    event.preventDefault();
    void copyLog();
  }

  return (
    <section className="panel">
      <header className="panel__header">
        <span className="panel__title">{t("workbench.panel.queryResult")}</span>
        <div className="panel__actions">
          <span className={`panel__status panel__status--${queryState.status}`}>
            {toStatusLabel(queryState.status, queryState.output, t)}
          </span>
          {isRunning ? (
            <button
              type="button"
              className="panel__action"
              title={t("workbench.panel.cancelQuery")}
              aria-label={t("workbench.panel.cancelQuery")}
              onClick={() =>
                void CommandService.executeCommand("silk.query.cancel")
              }
            >
              <Codicon name="debug-stop" />
            </button>
          ) : null}
          {showLog ? (
            <button
              type="button"
              className="panel__action"
              title={t("app.query.copyLogTitle")}
              aria-label={t("app.query.copyLog")}
              onClick={() => void copyLog()}
            >
              <Codicon name="copy" />
            </button>
          ) : null}
          {queryState.tabs.length === 1 && queryState.activeTabId ? (
            <button
              type="button"
              className="panel__action"
              title={t("workbench.panel.closeResult")}
              aria-label={t("workbench.panel.closeResult")}
              onClick={() =>
                QueryExecutionService.closeTab(queryState.activeTabId!)
              }
            >
              <Codicon name="close" />
            </button>
          ) : null}
          {queryState.tabs.length > 1 ? (
            <button
              type="button"
              className="panel__action"
              title={t("workbench.panel.closeAllResults")}
              aria-label={t("workbench.panel.closeAllResults")}
              onClick={() => QueryExecutionService.closeAllTabs()}
            >
              <Codicon name="close-all" />
            </button>
          ) : null}
          <button
            type="button"
            className="panel__action"
            title={movePanelLabel}
            aria-label={movePanelLabel}
            onClick={() =>
              void CommandService.executeCommand(
                layout.panelPosition === "bottom"
                  ? "workbench.action.movePanelToRight"
                  : "workbench.action.movePanelToBottom",
              )
            }
          >
            <Codicon
              name={
                layout.panelPosition === "bottom"
                  ? "layout-sidebar-right"
                  : "layout-panel"
              }
            />
          </button>
          <button
            type="button"
            className="panel__action"
            title={maximizeLabel}
            aria-label={maximizeLabel}
            onClick={() =>
              void CommandService.executeCommand(
                "workbench.action.toggleMaximizedPanel",
              )
            }
          >
            <Codicon
              name={
                layout.panelMaximized ? "chevron-down" : "chevron-up"
              }
            />
          </button>
        </div>
      </header>

      {queryState.tabs.length > 1 ? (
        <div
          className="panel__tabs"
          role="tablist"
          aria-label={t("workbench.panel.queryResultsAria")}
        >
          {queryState.tabs.map((tab) => {
            const isActive = tab.id === queryState.activeTabId;
            return (
              <div
                key={tab.id}
                className={`panel__tab${isActive ? " panel__tab--active" : ""}`}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                title={truncateSqlLabel(tab.sql)}
                onClick={() => QueryExecutionService.setActiveTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    QueryExecutionService.setActiveTab(tab.id);
                  }
                }}
              >
                <span className="panel__tab-label">{tab.title}</span>
                <button
                  type="button"
                  className="panel__tab-close"
                  title={t("workbench.panel.close")}
                  aria-label={`${t("workbench.panel.close")} ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    QueryExecutionService.closeTab(tab.id);
                  }}
                >
                  <Codicon name="close" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="panel__body">
        {isRunning && (gridResult || activeTab) ? (
          <div className="panel__running-banner" role="status">
            {queryState.output}
          </div>
        ) : null}

        {showErrorOrCancel ? (
          <pre
            ref={logPreRef}
            className="panel__content panel__content--error"
            tabIndex={0}
            onKeyDown={handleLogKeyDown}
          >
            {queryState.output}
          </pre>
        ) : gridResult && activeTab ? (
          <QueryResultGrid
            key={activeTab.id}
            tabId={activeTab.id}
            sql={activeTab.sql}
            result={gridResult}
            relationKind={activeTab.relationKind}
            connectionId={activeTab.connectionId}
          />
        ) : (
          <pre
            ref={logPreRef}
            className="panel__content"
            tabIndex={0}
            onKeyDown={handleLogKeyDown}
          >
            {activeTab?.output ?? queryState.output}
          </pre>
        )}
      </div>
    </section>
  );
}

function toStatusLabel(
  status: "idle" | "running" | "success" | "error" | "cancelled",
  output: string,
  t: (key:
    | "workbench.panel.statusIdle"
    | "workbench.panel.statusRunning"
    | "workbench.panel.statusSuccess"
    | "workbench.panel.statusError"
    | "workbench.panel.statusCancelled") => string,
): string {
  switch (status) {
    case "running":
      return t("workbench.panel.statusRunning");
    case "success":
      return output || t("workbench.panel.statusSuccess");
    case "error":
      return t("workbench.panel.statusError");
    case "cancelled":
      return t("workbench.panel.statusCancelled");
    default:
      return t("workbench.panel.statusIdle");
  }
}

export default Panel;
