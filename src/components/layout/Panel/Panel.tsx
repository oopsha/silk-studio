import "./Panel.css";
import { useQueryExecutionState } from "../../../services/query/useQueryExecutionState";

function Panel() {
  const queryState = useQueryExecutionState();

  return (
    <section className="panel">
      <header className="panel__header">
        <span className="panel__title">Query Result</span>
        <span className={`panel__status panel__status--${queryState.status}`}>
          {toStatusLabel(queryState.status)}
        </span>
      </header>
      <pre className="panel__content">{queryState.output}</pre>
    </section>
  );
}

function toStatusLabel(status: "idle" | "running" | "success" | "error"): string {
  switch (status) {
    case "running":
      return "Running";
    case "success":
      return "Success";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

export default Panel;
