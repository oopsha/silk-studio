import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type CSSProperties, type MouseEvent } from "react";
import ResourceExplorer, { type ResourceColumn, type ResourceLocate } from "@silk-studio/workbench/components/explorer/ResourceExplorer.tsx";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import type { ResourceNode } from "@silk-studio/workbench/components/explorer/resourceExplorerTypes.ts";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { revealInFolder, type ArchiveListing } from "../archive";
import { ConfirmDialogService } from "@silk-studio/workbench/services/dialog/confirmDialogService.ts";
import { archiveNodePath, archiveRoute, createArchiveSource, type SearchItem } from "../archiveSource";
import ArchiveSearchView from "./ArchiveSearchView";
import { useActiveView } from "@silk-studio/workbench/services/view/useActiveView.ts";
import type { ExtractTarget } from "../extractTargets";
import { useZipSettings } from "../zipSettings";
import ExtractMenu, { type MenuAnchor } from "./ExtractMenu";
import ViewPaneTitle from "@silk-studio/workbench/components/layout/Sidebar/ViewPaneTitle/ViewPaneTitle.tsx";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";

export type RenameEntry = { path: string; name: string; directory: boolean };

const columns: readonly ResourceColumn[] = [
  { id: "encrypted", title: "암호화", render: (node) => node.encrypted ? "예" : "" },
  { id: "status", title: "상태", render: (node) => node.status ?? "" },
];

interface ArchiveExplorerProps {
  archive: ArchiveListing;
  onExtract: (target: ExtractTarget, entries?: string[]) => void;
  onTest: () => void;
  onRename: (entry: RenameEntry) => void;
  /** Updated with the single selected entry so menu commands (F2) can act on it. */
  selectionRef: MutableRefObject<RenameEntry | null>;
  /** Updated with the folder shown in the list (archive path, "" for the root). */
  folderRef: MutableRefObject<string>;
  /** Updated with the archive paths of the selected entries (for remove commands). */
  selectedPathsRef: MutableRefObject<string[]>;
  editor: ArchiveEditor;
}

/** Edit actions on the opened archive; changes stay pending until applied. */
export interface ArchiveEditor {
  canEdit: boolean;
  addFiles: (folder: string) => void;
  addFolder: (folder: string) => void;
  newFolder: (folder: string) => void;
  remove: (paths: string[]) => void;
  pendingCount: number;
  apply: () => void;
  discard: () => void;
}

export default function ArchiveExplorer({ archive, onExtract, onTest, onRename, selectionRef, folderRef, selectedPathsRef, editor }: ArchiveExplorerProps) {
  const layout = useLayoutState();
  const activeView = useActiveView();
  const [locate, setLocate] = useState<ResourceLocate | undefined>(undefined);
  const { extractTarget } = useZipSettings();
  const source = useMemo(() => createArchiveSource(archive), [archive]);
  const [menu, setMenu] = useState<(MenuAnchor & { selection?: { label: string; paths: string[] }; rename?: RenameEntry; reveal?: boolean }) | null>(null);
  const selected = useRef<readonly ResourceNode[]>([]);
  const [folder, setFolder] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pathMenu, setPathMenu] = useState<{ x: number; y: number } | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const onSelectionChange = useCallback((nodes: readonly ResourceNode[]) => {
    selected.current = nodes;
    ContextKeyService.set("hasArchiveEntrySelection", nodes.length > 0);
    const path = nodes.length === 1 ? archiveNodePath(archive, nodes[0]) : null;
    selectionRef.current = path ? { path, name: nodes[0].name, directory: nodes[0].directory } : null;
    ContextKeyService.set("canRenameEntry", selectionRef.current !== null && editor.canEdit);
    selectedPathsRef.current = nodes.map((node) => archiveNodePath(archive, node)).filter((path): path is string => path !== null);
    ContextKeyService.set("canRemoveEntries", selectedPathsRef.current.length > 0 && editor.canEdit);
    setSelectedCount(selectedPathsRef.current.length);
  }, [archive, selectionRef, selectedPathsRef, editor.canEdit]);

  const onRouteChange = useCallback((route: readonly ResourceNode[]) => {
    const last = route[route.length - 1];
    const path = last ? archiveNodePath(archive, last) ?? "" : "";
    folderRef.current = path;
    setFolder(path);
  }, [archive, folderRef]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const closeOutside = (event: globalThis.MouseEvent) => { if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAddMenuOpen(false); };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("mousedown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [addMenuOpen]);

  useEffect(() => () => { selectionRef.current = null; selectedPathsRef.current = []; folderRef.current = ""; ContextKeyService.set("canRenameEntry", false); ContextKeyService.set("canRemoveEntries", false); }, [selectionRef, selectedPathsRef, folderRef]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const currentSelection = (nodes: readonly ResourceNode[]) => {
    const paths = nodes.map((node) => archiveNodePath(archive, node)).filter((path): path is string => path !== null);
    const label = nodes.length === 1 ? `'${nodes[0].name}'` : `${nodes.length.toLocaleString()}개 항목`;
    return paths.length ? { label, paths } : undefined;
  };
  const openMenuBelow = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 2, selection: currentSelection(selected.current) });
  };
  const openContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    // Only offer the selected entries when the click landed on a list row.
    const onRow = (event.target as HTMLElement).closest("tbody tr") !== null;
    setMenu({ x: event.clientX, y: event.clientY, selection: onRow ? currentSelection(selected.current) : undefined, rename: onRow && editor.canEdit ? selectionRef.current ?? undefined : undefined, reveal: true });
  };
  const fileName = archive.path.slice(Math.max(archive.path.lastIndexOf("\\"), archive.path.lastIndexOf("/")) + 1);
  const header = (
    <div className="zip-archive-header zip-toolbar">
      <div className="zip-archive-header__text"><h1 title={fileName}>{fileName}</h1><p title={archive.path}>{archive.path}</p></div>
      <div className="zip-toolbar__actions">
        <div className="zip-add-menu" ref={addMenuRef}>
          <div className="zip-extract-split">
            <button type="button" className="zip-button zip-extract-split__main" title={editor.canEdit ? "파일 추가 (Insert)" : "이 형식은 수정할 수 없습니다 (zip, 7z, tar만 가능)"} disabled={!editor.canEdit} onClick={() => editor.addFiles(folder)}>추가</button>
            <button type="button" className="zip-button zip-extract-split__arrow" aria-label="추가 옵션" aria-haspopup="menu" aria-expanded={addMenuOpen} disabled={!editor.canEdit} onClick={() => setAddMenuOpen((open) => !open)}><Codicon name="chevron-down" /></button>
          </div>
          {addMenuOpen ? <div className="zip-add-menu__popup" role="menu"><button role="menuitem" onClick={() => { setAddMenuOpen(false); editor.addFiles(folder); }}>파일 추가</button><button role="menuitem" onClick={() => { setAddMenuOpen(false); editor.addFolder(folder); }}>폴더 추가</button></div> : null}
        </div>
        <button type="button" className="zip-button" disabled={!editor.canEdit} title="현재 폴더에 새 폴더 만들기" onClick={() => editor.newFolder(folder)}>새 폴더</button>
        <button type="button" className="zip-button" disabled={!editor.canEdit || selectedCount === 0} title="선택한 항목 제거 (Delete)" onClick={() => editor.remove(selectedPathsRef.current)}>제거</button>
        <div className="zip-extract-split">
          <button type="button" className="zip-button zip-extract-split__main" title="압축 풀기 (Ctrl+E)" onClick={() => onExtract(extractTarget)}>압축 풀기</button>
          <button type="button" className="zip-button zip-extract-split__arrow" title="풀기 옵션" aria-label="풀기 옵션" aria-haspopup="menu" aria-expanded={menu !== null} onClick={openMenuBelow}>
            <Codicon name="chevron-down" />
          </button>
        </div>
      </div>
    </div>
  );
  return <section className={`zip-archive-workspace${layout.sidebar ? "" : " zip-archive-workspace--sidebar-hidden"}`} aria-label="압축 파일 탐색기">
    {archive.warnings.map((warning, index) => <p className="zip-message" key={index}>{warning}</p>)}
    {editor.pendingCount > 0 ? <div className="zip-pending-bar" role="status">
      <span>{`변경 ${editor.pendingCount.toLocaleString()}개가 대기 중입니다. 적용해야 압축 파일에 반영됩니다.`}</span>
      <span className="zip-pending-bar__actions"><button type="button" className="zip-button" onClick={editor.discard}>모두 취소</button><button type="button" className="zip-button primary" onClick={editor.apply}>적용</button></span>
    </div> : null}
    <div className="zip-explorer-content" style={{ "--zip-sidebar-width": layout.sidebar ? `${layout.sidebarWidth}px` : "0px" } as CSSProperties}>
      {layout.sidebar ? <div className="zip-explorer-title"><ViewPaneTitle title={activeView === "search" ? "검색" : "탐색기"} /></div> : null}
      <ResourceExplorer
        source={source}
        resetKey={archive.path}
        onRouteChange={onRouteChange}
        onSelectionChange={onSelectionChange}
        extraColumns={columns}
        header={header}
        locate={locate}
        sidebar={activeView === "search" ? <ArchiveSearchView archive={archive} folder={folder} onReveal={(item: SearchItem) => setLocate((previous) => ({ route: archiveRoute(archive, item.parent), select: item.id, nonce: (previous?.nonce ?? 0) + 1 }))} /> : undefined}
        addressExtra={<button type="button" className="zip-path-copy" title="경로 복사" aria-label="경로 복사" aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setPathMenu({ x: rect.right, y: rect.bottom + 2 }); }}><Codicon name="copy" /></button>}
        onListContextMenu={openContextMenu}
        onTreeContextMenu={openContextMenu}
        rowAction={{ icon: "export", title: "압축 풀기" }}
        onRowMenu={(nodes, at) => setMenu({ ...at, selection: currentSelection(nodes), rename: nodes.length === 1 && editor.canEdit ? selectionRef.current ?? undefined : undefined, reveal: true })}
      />
    </div>
    {pathMenu ? <PathCopyMenu anchor={pathMenu} archivePath={archive.path} folder={folder} onClose={() => setPathMenu(null)} /> : null}
    {menu ? <ExtractMenu archivePath={archive.path} anchor={menu} onClose={closeMenu} selectionLabel={menu.selection?.label} onRename={menu.rename ? () => { const entry = menu.rename!; setMenu(null); onRename(entry); } : undefined} onTestArchive={menu.reveal ? () => { setMenu(null); onTest(); } : undefined} onRevealArchive={menu.reveal ? () => { setMenu(null); void revealInFolder(archive.path).catch((reason) => ConfirmDialogService.confirm({ title: "압축 파일 위치 열기", message: String(reason), confirmLabel: "확인", hideCancel: true })); } : undefined} onPick={(target, scope) => { const entries = scope === "selection" && menu.selection ? menu.selection.paths : undefined; setMenu(null); onExtract(target, entries); }} /> : null}
  </section>;
}

/** Small popup next to the address bar that copies the archive or the shown folder path as text. */
function PathCopyMenu({ anchor, archivePath, folder, onClose }: { anchor: { x: number; y: number }; archivePath: string; folder: string; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const copy = (text: string) => { onClose(); void navigator.clipboard.writeText(text).catch((reason) => console.warn("[silkZip.copyPath]", reason)); };
  const separator = archivePath.includes("\\") ? "\\" : "/";
  return <div className="zip-path-menu" role="menu" style={{ left: anchor.x, top: anchor.y }} onMouseDown={(event) => event.stopPropagation()}>
    <button role="menuitem" onClick={() => copy(archivePath)}>압축 파일 경로 복사</button>
    {folder ? <button role="menuitem" onClick={() => copy(`${archivePath}${separator}${folder.replace(/\//g, separator)}`)}>현재 폴더 경로 복사</button> : null}
  </div>;
}
