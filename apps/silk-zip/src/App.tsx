import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import ActivityBar from "@silk-studio/workbench/components/layout/ActivityBar/index.ts";
import ViewPaneTitle from "@silk-studio/workbench/components/layout/Sidebar/ViewPaneTitle/ViewPaneTitle.tsx";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";
import type { ActivityViewContribution } from "@silk-studio/workbench/services/view/viewService.ts";
import { startWindowLayoutSync } from "@silk-studio/workbench/services/layout/windowLayoutSync.ts";
import TitleBar from "@silk-studio/workbench/components/layout/TitleBar/index.ts";
import Menubar from "@silk-studio/workbench/components/menubar/index.ts";
import { detectWorkbenchPlatform } from "@silk-studio/ui/platform/fonts.ts";
import "./activityBar";
import "./menubar";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { listArchive, type ArchiveListing } from "./archive";
import ArchiveExplorer from "./components/ArchiveExplorer";
import { startRecentArchives } from "./recentArchives";

const ARCHIVE_FILE_FILTERS = [
  { name: "압축 파일", extensions: ["zip", "zipx", "tar", "tgz", "taz", "gz", "gzip", "bz2", "xz", "txz", "lz", "lzma", "lzh", "lha", "iso", "7z", "zpaq", "rar", "rar5"] },
  { name: "모든 파일", extensions: ["*"] },
];

const activityViews: readonly ActivityViewContribution[] = [
  { id: "explorer", icon: "files", label: "탐색기", render: () => null },
];

function App() {
  const layout = useLayoutState();
  useEffect(() => startWindowLayoutSync(), []);
  const [files, setFiles] = useState<string[]>([]);
  const [archive, setArchive] = useState<ArchiveListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    ContextKeyService.set("hasOpenArchive", archive !== null);
    ContextKeyService.set("hasArchiveEntrySelection", false);
  }, [archive]);

  useEffect(() => {
    let disposed = false;
    const recentArchives = startRecentArchives(async (path) => {
      if (busy.current) return;
      busy.current = true;
      try {
        setLoading(true);
        setError(null);
        const result = await listArchive(path);
        if (!disposed) setArchive(result);
      } catch (reason) {
        if (!disposed) setError(String(reason));
      } finally {
        busy.current = false;
        if (!disposed) setLoading(false);
      }
    });
    const openArchive = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const path = await open({ multiple: false, directory: false, filters: ARCHIVE_FILE_FILTERS });
        if (disposed || !path || Array.isArray(path)) return;
        setLoading(true);
        setError(null);
        const result = await listArchive(path);
        if (!disposed) { setArchive(result); recentArchives.record(path); }
      } catch (reason) {
        if (!disposed) setError(String(reason));
      } finally {
        busy.current = false;
        if (!disposed) setLoading(false);
      }
    };
    const unregister = CommandsRegistry.registerCommand("silkZip.file.openArchive", openArchive);
    const unregisterKey = KeybindingsRegistry.registerKeybinding("silkZip.file.openArchive", detectWorkbenchPlatform() === "mac" ? "Cmd+O" : "Ctrl+O");
    const onKeyDown = (event: KeyboardEvent) => { KeybindingsRegistry.handleKeyboardEvent(event); };
    window.addEventListener("keydown", onKeyDown);
    return () => { disposed = true; recentArchives.stop(); unregisterKey(); unregister(); window.removeEventListener("keydown", onKeyDown); };
  }, []);
  const addFiles = async () => {
    const selected = await open({ multiple: true, directory: false });
    if (selected) setFiles((current) => [...current, ...(Array.isArray(selected) ? selected : [selected])]);
  };

  return (
    <main className="zip-app">
      {detectWorkbenchPlatform() === "windows" ? <TitleBar /> : <div className="zip-menubar"><Menubar /></div>}
      <div className="zip-workbench">
        <div className="zip-activity-bar">
          <ActivityBar views={activityViews} />
        </div>
        <div className="zip-workbench__main">
          {loading ? <div className="zip-message" role="status">압축 파일을 읽고 있습니다…</div> : null}
          {error ? <div className="zip-message zip-message--error" role="alert">{error}</div> : null}
          {archive ? <ArchiveExplorer archive={archive} /> : <div className="zip-start-workspace">
          {layout.sidebar ? <aside className="zip-empty-explorer" style={{ width: layout.sidebarWidth }} aria-label="탐색기"><ViewPaneTitle title="탐색기" /></aside> : null}
          <section className="zip-content">
            <div className="zip-toolbar"><div><h1>새 압축 파일</h1><p>파일을 선택하고 원하는 형식으로 압축하세요.</p></div><div className="zip-toolbar__actions"><select aria-label="압축 형식" defaultValue="zip"><option value="zip">ZIP</option><option value="zipx">ZIPX</option><option value="7z">7z</option><option value="tar">TAR</option><option value="gz">GZ</option><option value="xz">XZ</option><option value="iso">ISO</option><option disabled>────────────</option><option value="exe" disabled>EXE</option><option value="lzh" disabled>LZH</option><option value="zpaq" disabled>ZPAQ</option></select><button className="zip-button" onClick={addFiles}>파일 추가</button></div></div>
            <div className="zip-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFiles((current) => [...current, ...Array.from(event.dataTransfer.files, (file) => file.name)]); }}>
              {files.length === 0 ? <><div className="zip-empty-icon">＋</div><strong>파일을 여기로 끌어오세요</strong><span>또는 파일 추가를 눌러 선택</span></> : <div className="zip-file-list">{files.map((file, index) => <div className="zip-file" key={`${file}-${index}`}><span className="codicon codicon-file" />{file}</div>)}</div>}
            </div>
            <footer className="zip-footer"><span>{files.length}개 항목</span><button className="zip-button primary" disabled>압축 시작</button></footer>
          </section></div>}
        </div>
      </div>
      <div className="zip-status"><span>{archive?.engine ?? "압축 파일을 열려면 파일 메뉴 또는 Ctrl+O를 사용하세요."}</span><span>Silk Studio</span></div>
    </main>
  );
}

export default App;
