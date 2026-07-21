import "./Panel.css";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";
import { useQueryExecutionState } from "../../../services/query/useQueryExecutionState";
import QueryResultGrid from "./QueryResultGrid";

function Panel() {
  const queryState = useQueryExecutionState();
  const layout = useLayoutState();
  const showGrid =
    queryState.status === "success" &&
    queryState.result?.kind === "resultSet" &&
    queryState.result.columns.length > 0;

  return (
    <section className="panel">
      <header className="panel__header">
        <span className="panel__title">Query Result</span>
        <div className="panel__actions">
          <span className={`panel__status panel__status--${queryState.status}`}>
            {toStatusLabel(queryState.status, queryState.output)}
          </span>
          <button
            type="button"
            className="panel__action"
            title={
              layout.panelPosition === "bottom"
                ? "Move Panel Right"
                : "Move Panel To Bottom"
            }
            aria-label={
              layout.panelPosition === "bottom"
                ? "Move Panel Right"
                : "Move Panel To Bottom"
            }
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
            title={
              layout.panelMaximized ? "Restore Panel Size" : "Maximize Panel Size"
            }
            aria-label={
              layout.panelMaximized ? "Restore Panel Size" : "Maximize Panel Size"
            }
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
      {showGrid && queryState.result ? (
        <QueryResultGrid result={queryState.result} />
      ) : (
        <pre className="panel__content">{queryState.output}</pre>
      )}
    </section>
  );
}

function toStatusLabel(
  status: "idle" | "running" | "success" | "error",
  output: string,
): string {
  switch (status) {
    case "running":
      return "Running";
    case "success":
      return output || "Success";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

export default Panel;
