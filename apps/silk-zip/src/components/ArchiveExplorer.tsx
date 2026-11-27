import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type MouseEvent, type ReactNode } from "react";
import ResourceExplorer, { type ResourceLocate } from "@silk-studio/workbench/components/explorer/ResourceExplorer.tsx";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import type { ResourceNode } from "@silk-studio/workbench/components/explorer/resourceExplorerTypes.ts";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { revealInFolder, type ArchiveListing } from "../archive";
import { ConfirmDialogService } from "@silk-studio/workbench/services/dialog/confirmDialogService.ts";
import { archiveColumns, draftColumns, STATUS_ICONS } from "../archiveColumns";
import { archiveNodePath, archiveRoute, createArchiveSource, type SearchItem } from "../archiveSource";
import ArchiveSearchView from "./ArchiveSearchView";
import { useActiveView } from "@silk-studio/workbench/services/view/useActiveView.ts";
import type { ExtractTarget } from "../extractTargets";
import { useZipSettings } from "../zipSettings";
import ExtractMenu, { type MenuAnchor } from "./ExtractMenu";
import ViewPaneTitle from "@silk-studio/workbench/components/layout/Sidebar/ViewPaneTitle/ViewPaneTitle.tsx";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";
import { tr } from "../i18n";

export type RenameEntry = { path: string; name: string; directory: boolean };


/** A new archive that is still being assembled: same explorer, different header action and a settings panel. */
export interface DraftOptions {
  title: string;
  subtitle: string;
  /** Shown in an empty folder. */
  emptyMessage: ReactNode;
  /** The main action, in the slot where an opened archive has "압축 풀기". */
  action: { label: string; disabled: boolean; onClick: () => void };
  /** Compression settings, shown below the list. */
  settings: ReactNode;
}

interface ArchiveExplorerProps {
  archive: ArchiveListing;
  draft?: DraftOptions;
  /** A file is being dragged over the window. */
  dragging?: boolean;
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

export default function ArchiveExplorer({ archive, draft, dragging, onExtract, onTest, onRename, selectionRef, folderRef, selectedPathsRef, editor }: ArchiveExplorerProps) {
  const layout = useLayoutState();
  const activeView = useActiveView();
  const [locate, setLocate] = useState<ResourceLocate | undefined>(undefined);
  const { extractTarget, viewMode, visibleColumns } = useZipSettings();
  const columns = useMemo(() => archiveColumns(visibleColumns), [visibleColumns]);
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
    ContextKeyService.set("hasArchiveEntrySelection", nodes.length > 0 && !draft);
    const path = nodes.length === 1 ? archiveNodePath(archive, nodes[0]) : null;
    selectionRef.current = path ? { path, name: nodes[0].name, directory: nodes[0].directory } : null;
    ContextKeyService.set("canRenameEntry", selectionRef.current !== null && editor.canEdit);
    selectedPathsRef.current = nodes.map((node) => archiveNodePath(archive, node)).filter((path): path is string => path !== null);
    ContextKeyService.set("canRemoveEntries", selectedPathsRef.current.length > 0 && editor.canEdit);
    setSelectedCount(selectedPathsRef.current.length);
  }, [archive, draft, selectionRef, selectedPathsRef, editor.canEdit]);

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
    const label = nodes.length === 1 ? `'${nodes[0].name}'` : tr("{0}개 항목", nodes.length.toLocaleString());
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
      <div className="zip-archive-header__text"><h1 title={draft ? draft.title : fileName}>{draft ? draft.title : fileName}</h1><p title={draft ? draft.subtitle : archive.path}>{draft ? draft.subtitle : archive.path}</p></div>
      <div className="zip-toolbar__actions">
        <div className="zip-add-menu" ref={addMenuRef}>
          <div className="zip-extract-split">
            <button type="button" className="zip-button zip-extract-split__main" title={editor.canEdit ? tr("파일 추가 (Insert)") : tr("이 형식은 수정할 수 없습니다 (zip, 7z, tar만 가능)")} disabled={!editor.canEdit} onClick={() => editor.addFiles(folder)}>{tr("추가")}</button>
            <button type="button" className="zip-button zip-extract-split__arrow" aria-label={tr("추가 옵션")} aria-haspopup="menu" aria-expanded={addMenuOpen} disabled={!editor.canEdit} onClick={() => setAddMenuOpen((open) => !open)}><Codicon name="chevron-down" /></button>
          </div>
          {addMenuOpen ? <div className="zip-add-menu__popup" role="menu"><button role="menuitem" onClick={() => { setAddMenuOpen(false); editor.addFiles(folder); }}>{tr("파일 추가")}</button><button role="menuitem" onClick={() => { setAddMenuOpen(false); editor.addFolder(folder); }}>{tr("폴더 추가")}</button></div> : null}
        </div>
        <button type="button" className="zip-button" disabled={!editor.canEdit} title={tr("현재 폴더에 새 폴더 만들기")} onClick={() => editor.newFolder(folder)}>{tr("새 폴더")}</button>
        <button type="button" className="zip-button" disabled={!editor.canEdit || selectedCount === 0} title={tr("선택한 항목 제거 (Delete)")} onClick={() => editor.remove(selectedPathsRef.current)}>{tr("제거")}</button>
        {draft ? <button type="button" className="zip-button primary" disabled={draft.action.disabled} onClick={draft.action.onClick}>{draft.action.label}</button> : <div className="zip-extract-split">
          <button type="button" className="zip-button primary zip-extract-split__main" title={tr("압축 풀기 (Ctrl+E)")} onClick={() => onExtract(extractTarget)}>{tr("압축 풀기")}</button>
          <button type="button" className="zip-button primary zip-extract-split__arrow" title={tr("풀기 옵션")} aria-label={tr("풀기 옵션")} aria-haspopup="menu" aria-expanded={menu !== null} onClick={openMenuBelow}>
            <Codicon name="chevron-down" />
          </button>
        </div>}
      </div>
    </div>
  );
  return <section className={`zip-archive-workspace${layout.sidebar ? "" : " zip-archive-workspace--sidebar-hidden"}${draft ? " zip-archive-workspace--draft" : ""}${dragging ? " zip-archive-workspace--dragging" : ""}`} aria-label={draft ? tr("새 압축 탐색기") : tr("압축 파일 탐색기")}>
    {archive.warnings.map((warning, index) => <p className="zip-message" key={index}>{warning}</p>)}
    {editor.pendingCount > 0 ? <div className="zip-pending-bar" role="status">
      <span>{tr("변경 {0}개가 대기 중입니다. 적용해야 압축 파일에 반영됩니다.", editor.pendingCount.toLocaleString())}</span>
      <span className="zip-pending-bar__actions"><button type="button" className="zip-button" onClick={editor.discard}>{tr("모두 취소")}</button><button type="button" className="zip-button primary" onClick={editor.apply}>{tr("적용")}</button></span>
    </div> : null}
    <div className="zip-explorer-content">
      <ResourceExplorer
        source={source}
        resetKey={draft ? "draft" : archive.path}
        emptyMessage={draft?.emptyMessage}
        footer={draft?.settings}
        onRouteChange={onRouteChange}
        onSelectionChange={onSelectionChange}
        columns={draft ? draftColumns : columns}
        statusIcons={editor.pendingCount > 0 ? STATUS_ICONS : undefined}
        header={header}
        sidebarTitle={<ViewPaneTitle title={activeView === "search" ? tr("검색") : tr("탐색기")} />}
        viewMode={viewMode}
        locate={locate}
        sidebar={activeView === "search" ? <ArchiveSearchView archive={archive} folder={folder} onReveal={(item: SearchItem) => setLocate((previous) => ({ route: archiveRoute(archive, item.parent), select: item.id, nonce: (previous?.nonce ?? 0) + 1 }))} /> : undefined}
        addressExtra={draft ? undefined : <button type="button" className="zip-path-copy" title={tr("경로 복사")} aria-label={tr("경로 복사")} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setPathMenu({ x: rect.right, y: rect.bottom + 2 }); }}><Codicon name="copy" /></button>}
        onListContextMenu={draft ? undefined : openContextMenu}
        onTreeContextMenu={draft ? undefined : openContextMenu}
        rowAction={draft ? undefined : { icon: "export", title: tr("압축 풀기") }}
        onRowMenu={draft ? undefined : (nodes, at) => setMenu({ ...at, selection: currentSelection(nodes), rename: nodes.length === 1 && editor.canEdit ? selectionRef.current ?? undefined : undefined, reveal: true })}
      />
    </div>
    {pathMenu ? <PathCopyMenu anchor={pathMenu} archivePath={archive.path} folder={folder} onClose={() => setPathMenu(null)} /> : null}
    {menu ? <ExtractMenu archivePath={archive.path} anchor={menu} onClose={closeMenu} selectionLabel={menu.selection?.label} onRename={menu.rename ? () => { const entry = menu.rename!; setMenu(null); onRename(entry); } : undefined} onTestArchive={menu.reveal ? () => { setMenu(null); onTest(); } : undefined} onRevealArchive={menu.reveal ? () => { setMenu(null); void revealInFolder(archive.path).catch((reason) => ConfirmDialogService.confirm({ title: tr("압축 파일 위치 열기"), message: String(reason), confirmLabel: tr("확인"), hideCancel: true })); } : undefined} onPick={(target, scope) => { const entries = scope === "selection" && menu.selection ? menu.selection.paths : undefined; setMenu(null); onExtract(target, entries); }} /> : null}
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
    <button role="menuitem" onClick={() => copy(archivePath)}>{tr("압축 파일 경로 복사")}</button>
    {folder ? <button role="menuitem" onClick={() => copy(`${archivePath}${separator}${folder.replace(/\//g, separator)}`)}>{tr("현재 폴더 경로 복사")}</button> : null}
  </div>;
}
