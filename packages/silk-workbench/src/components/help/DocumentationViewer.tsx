import "./DocumentationViewer.css";

type DocumentationViewerProps = {
  studioName?: string;
  backendStudio?: boolean;
};

function DocumentationViewer({
  studioName = "Silk DB Studio",
  backendStudio = false,
}: DocumentationViewerProps) {
  if (backendStudio) {
    return (
      <main
        className="documentation-viewer"
        data-testid="documentation-viewer"
        aria-label="Documentation"
      >
        <header className="documentation-viewer__header">
          <h1>{studioName} — User Guide</h1>
          <p>백엔드 프로젝트와 파일을 다루는 공용 워크벤치 안내입니다.</p>
        </header>

        <section className="documentation-viewer__section" aria-labelledby="doc-be-scope">
          <h2 id="doc-be-scope">Backend support</h2>
          <p>
            Spring 지원부터 시작해 Node.js, Python, PHP 개발 기능을 순차적으로
            확장할 예정입니다. 프로젝트 탐색, 실행 및 디버깅 기능은 개발 중입니다.
          </p>
        </section>

        <section className="documentation-viewer__section" aria-labelledby="doc-shortcuts">
          <h2 id="doc-shortcuts">Keyboard shortcuts</h2>
          <ul>
            <li><kbd>Ctrl+Shift+P</kbd> — Command Palette</li>
            <li><kbd>Ctrl+K Ctrl+S</kbd> — Keyboard Shortcuts</li>
            <li><kbd>Ctrl+,</kbd> — Settings</li>
          </ul>
        </section>

        <section className="documentation-viewer__section" aria-labelledby="doc-diag">
          <h2 id="doc-diag">Diagnostics</h2>
          <ul>
            <li>Help → <strong>About</strong> — 앱 버전과 정보</li>
            <li>Manage → <strong>AI Call Log</strong> — AI 요청 기록</li>
          </ul>
        </section>
      </main>
    );
  }

  return (
    <main
      className="documentation-viewer"
      data-testid="documentation-viewer"
      aria-label="Documentation"
    >
      <header className="documentation-viewer__header">
        <h1>{studioName} — User Guide</h1>
        <p>
          Install, update, shortcuts, and diagnostics. Full markdown lives in{" "}
          <code>docs/user-guide.md</code> in the repository.
        </p>
      </header>

      <section className="documentation-viewer__section" aria-labelledby="doc-install">
        <h2 id="doc-install">Install</h2>
        <ul>
          <li>
            Download the macOS or Windows installer from{" "}
            <strong>GitHub Releases</strong>.
          </li>
          <li>
            Packaged builds include <strong>jdbc-agent</strong> and a bundled{" "}
            <strong>JRE 17</strong> — system Java is not required.
          </li>
          <li>
            Details: <code>docs/bundled-runtime.md</code>
          </li>
        </ul>
      </section>

      <section className="documentation-viewer__section" aria-labelledby="doc-update">
        <h2 id="doc-update">Updates</h2>
        <ul>
          <li>
            Manage (gear) → <strong>Check for Updates…</strong>
          </li>
          <li>
            Updates are signed via Tauri updater + GitHub Releases (
            <code>latest.json</code>).
          </li>
          <li>
            Details: <code>docs/release.md</code>
          </li>
        </ul>
      </section>

      <section className="documentation-viewer__section" aria-labelledby="doc-shortcuts">
        <h2 id="doc-shortcuts">Keyboard shortcuts</h2>
        <ul>
          <li>
            <kbd>Ctrl+Shift+P</kbd> — Command Palette
          </li>
          <li>
            <kbd>Ctrl+K Ctrl+S</kbd> — Keyboard Shortcuts (this app view)
          </li>
          <li>
            <kbd>Ctrl+,</kbd> — Settings
          </li>
          <li>
            Search all registered bindings in{" "}
            <strong>Keyboard Shortcuts</strong> (Help or Manage menu).
          </li>
        </ul>
      </section>

      <section className="documentation-viewer__section" aria-labelledby="doc-diag">
        <h2 id="doc-diag">Diagnostics</h2>
        <ul>
          <li>
            Help → <strong>Copy Diagnostics</strong> — clipboard summary for bug
            reports (secrets redacted).
          </li>
          <li>
            Help → <strong>Open Log Folder</strong> — app log files.
          </li>
          <li>
            Help → <strong>About</strong> — version info.
          </li>
        </ul>
      </section>

      <p className="documentation-viewer__note" role="note">
        Smoke checks for packaged builds: <code>docs/smoke-checklist.md</code>
      </p>
    </main>
  );
}

export default DocumentationViewer;
