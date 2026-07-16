import "./Panel.css";
import { useQueryExecutionState } from "../../../services/query/useQueryExecutionState";
import QueryResultGrid from "./QueryResultGrid";

function Panel() {
  const queryState = useQueryExecutionState();
  const showGrid =
    queryState.status === "success" &&
    queryState.result?.kind === "resultSet" &&
    queryState.result.columns.length > 0;

  return (
    <section className="panel">
      <header className="panel__header">
        <span className="panel__title">Query Result</span>
        <span className={`panel__status panel__status--${queryState.status}`}>
          {toStatusLabel(queryState.status, queryState.output)}
        </span>
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
