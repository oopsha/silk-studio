import "./StatusBar.css";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { useEditorCursorPosition } from "@silk-studio/editor/services/editor/useEditorCursorPosition.ts";

function StatusBar() {
  const activeTab = useActiveEditor();
  const cursorPosition = useEditorCursorPosition();

  const branch = `main${activeTab?.isDirty ? "*" : ""}`;
  const progressMessage: string | null = null;

  return (
    <footer className="status-bar" role="contentinfo" aria-label="Status Bar">
      <div className="status-bar__left">
        <button type="button" className="status-bar__item">
          <Codicon name="source-control" />
          <span>{branch}</span>
        </button>

        <button type="button" className="status-bar__item">
          <Codicon name="error" />
          <span>0</span>
          <Codicon name="warning" />
          <span>0</span>
        </button>

        {progressMessage ? (
          <button type="button" className="status-bar__item">
            <Codicon name="loading" />
            <span>{progressMessage}</span>
          </button>
        ) : null}
      </div>

      <div className="status-bar__right">
        <button type="button" className="status-bar__item">
          <span>
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
        </button>

        <button type="button" className="status-bar__item">
          <span>Spaces: 4</span>
        </button>

        <button type="button" className="status-bar__item">
          <span>UTF-8</span>
        </button>

        <button type="button" className="status-bar__item">
          <span>CRLF</span>
        </button>

        <button type="button" className="status-bar__item">
          <span>{toLanguageLabel(activeTab?.languageId)}</span>
        </button>

        <div className="status-bar__icons">
          <button type="button" className="status-bar__icon-button">
            <Codicon name="account" />
          </button>
          <button type="button" className="status-bar__icon-button">
            <Codicon name="bell" />
          </button>
        </div>
      </div>
    </footer>
  );
}

function toLanguageLabel(languageId: string | undefined): string {
  if (!languageId || languageId === "plaintext") {
    return "Plain Text";
  }

  switch (languageId) {
    case "sql":
      return "SQL";
    case "plsql":
      return "PL/SQL";
    case "tsql":
      return "T-SQL";
    case "mysql":
      return "MySQL";
    case "mariadb":
      return "MariaDB";
    case "pgsql":
      return "PostgreSQL";
    case "typescript":
      return "TypeScript";
    case "javascript":
      return "JavaScript";
    case "json":
      return "JSON";
    case "powershell":
      return "PowerShell";
    default:
      return languageId.toUpperCase();
  }
}

export default StatusBar;
