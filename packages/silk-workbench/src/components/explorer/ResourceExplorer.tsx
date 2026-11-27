import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import WorkbenchSash from "../layout/WorkbenchSash";
import { useWorkbenchSashDrag } from "../../services/layout/useWorkbenchSashDrag";
import { LayoutService } from "../../services/layout/layoutService";
import { useLayoutState } from "../../services/layout/useLayoutState";
import ResourceTree from "./ResourceTree";
import ResourceIconView from "./ResourceIconView";
import { useMarqueeSelection } from "./useMarqueeSelection";
import { sortResources, type ResourceNode, type ResourceRowAction, type ResourceSource, type RowMenuHandler } from "./resourceExplorerTypes";
import "./ResourceExplorer.css";
import { koEn } from "../../platform/i18n/koEn";

/** Asks the explorer to show a folder and select one of its items (e.g. from a search result). */
export type ResourceLocate = { route: readonly ResourceNode[]; select: string; nonce: number };

/** How the folder content is laid out: a table, or names only in columns, or icon grids. */
export type ResourceViewMode = "details" | "list" | "icons" | "large-icons";

export type ResourceColumn = { id: string; title: string; render: (node: ResourceNode) => ReactNode; align?: "right" };

/** Shown when the app does not supply its own `columns`. */
const BUILTIN_COLUMNS: readonly ResourceColumn[] = [
  { id: "kind", get title() { return koEn("종류", "Type"); }, render: (node) => (node.directory ? koEn("폴더", "Folder") : koEn("파일", "File")) },
  { id: "size", get title() { return koEn("크기", "Size"); }, render: (node) => (node.directory || node.size == null ? "—" : `${node.size.toLocaleString()} B`) },
];
type Props = {
  source: ResourceSource;
  onOpenFile?: (node: ResourceNode) => void;
  /** Called with the selected nodes of the current folder (empty when nothing is selected). */
  onSelectionChange?: (nodes: readonly ResourceNode[]) => void;
  extraColumns?: readonly ResourceColumn[];
  /** All columns after the name; replaces the built-in kind and size columns (and `extraColumns`). */
  columns?: readonly ResourceColumn[];
  /** Icons for node `status` texts. When given, the table gets a narrow first column and the other views a small badge; the text is the tooltip. */
  statusIcons?: Readonly<Record<string, { name: string; className: string }>>;
  /** Content rendered above the address bar. */
  /** Shown at the top of the column right of the tree. */
  header?: ReactNode;
  /** Shown at the top of the sidebar, above the tree. */
  sidebarTitle?: ReactNode;
  /** Shown below the file list, in the column right of the tree. */
  footer?: ReactNode;
  /** Shown instead of "이 폴더는 비어 있습니다." when a folder has no items. */
  emptyMessage?: ReactNode;
  viewMode?: ResourceViewMode;
  /** Replaces the folder tree in the sidebar (e.g. with a search view). */
  sidebar?: ReactNode;
  /** Changing `nonce` navigates to `route` and selects `select`. */
  locate?: ResourceLocate;
  /** Content shown at the right end of the address bar (e.g. a copy-path button). */
  addressExtra?: ReactNode;
  onListContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  /** Hover button shown on list and tree rows; clicking it calls `onRowMenu`. */
  rowAction?: ResourceRowAction;
  /** Called for the row button and for right-clicks on rows with the rows it applies to. */
  onRowMenu?: RowMenuHandler;
  onTreeContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  /** Changing this (not `source`) sends the view back to the root; lets a source update in place. */
  resetKey?: string;
  /** Called with the folder chain (root first) whenever the shown folder changes. */
  onRouteChange?: (route: readonly ResourceNode[]) => void;
};

export default function ResourceExplorer({ source, onOpenFile, onSelectionChange, extraColumns = [], columns, statusIcons, header, sidebarTitle, footer, emptyMessage, viewMode = "details", sidebar, locate, addressExtra, onListContextMenu, onTreeContextMenu, rowAction, onRowMenu, resetKey, onRouteChange }: Props) {
  const [route, setRoute] = useState<readonly ResourceNode[]>([source.root]);
  const [nodes, setNodes] = useState<readonly ResourceNode[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef(0);
  const pendingSelect = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const expandedPath = useMemo(() => route.slice(0, -1).map((node) => node.id), [route]);
  const layout = useLayoutState();
  const { startDrag } = useWorkbenchSashDrag();
  const body = useRef<HTMLDivElement>(null);
  const current = route[route.length - 1];
  useEffect(() => { setRoute([source.root]); }, [resetKey ?? source]);
  useEffect(() => { onRouteChange?.(route); }, [route, onRouteChange]);
  /** Selects `id` among `list` (switching to its page) and scrolls it into view. */
  const focusNode = (list: readonly ResourceNode[], id: string) => {
    const index = list.findIndex((node) => node.id === id);
    if (index < 0) return;
    setPage(Math.floor(index / 500));
    setSelectedIds(new Set([id]));
    anchor.current = index % 500;
    onSelectionChange?.([list[index]]);
    setTimeout(() => listRef.current?.querySelector('tr[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }), 0);
  };
  useEffect(() => {
    if (!locate) return;
    const target = locate.route[locate.route.length - 1];
    if (target.id === current.id) { if (nodes) focusNode(nodes, locate.select); return; }
    pendingSelect.current = locate.select;
    setRoute(locate.route);
  }, [locate?.nonce]);
  useEffect(() => {
    let active = true;
    setNodes(null); setError(""); setPage(0); setSelectedIds(new Set()); onSelectionChange?.([]);
    Promise.resolve().then(() => source.readChildren(current.id)).then((children) => {
      if (!active) return;
      const sorted = sortResources(children);
      setNodes(sorted);
      const wanted = pendingSelect.current;
      if (wanted) { pendingSelect.current = null; focusNode(sorted, wanted); }
    }).catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [source, current.id, revision, onSelectionChange]);
  const open = (node: ResourceNode) => node.directory ? setRoute([...route, node]) : onOpenFile?.(node);
  const pages = Math.max(1, Math.ceil((nodes?.length ?? 0) / 500));
  const visible = (nodes ?? []).slice(page * 500, (page + 1) * 500);
  const select = (ids: ReadonlySet<string>) => {
    setSelectedIds(ids);
    onSelectionChange?.(visible.filter((node) => ids.has(node.id)));
  };
  // The row menu applies to the whole selection when the row is part of it, else to that row.
  const rowTargets = (node: ResourceNode, index: number) => {
    if (selectedIds.has(node.id)) return visible.filter((item) => selectedIds.has(item.id));
    anchor.current = index;
    select(new Set([node.id]));
    return [node];
  };
  // Click selects one row; Ctrl/Cmd toggles; Shift selects the range from the last plain click.
  const clickRow = (event: MouseEvent<HTMLElement>, index: number) => {
    const id = visible[index].id;
    if (event.shiftKey) {
      const next = new Set<string>(event.ctrlKey || event.metaKey ? selectedIds : []);
      for (let i = Math.min(anchor.current, index); i <= Math.max(anchor.current, index); i += 1) next.add(visible[i].id);
      select(next);
    } else if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      anchor.current = index;
      select(next);
    } else {
      anchor.current = index;
      select(new Set([id]));
    }
  };
  const tableColumns = columns ?? [...BUILTIN_COLUMNS, ...extraColumns];
  const statusBadge = (node: ResourceNode) => {
    const icon = node.status ? statusIcons?.[node.status] : undefined;
    return icon ? <span className="resource-explorer__status-icon" title={node.status} aria-label={node.status}><Codicon name={icon.name} className={icon.className} /></span> : null;
  };
  const marqueeSelection = useMarqueeSelection({ idAt: (index) => visible[index]?.id, selected: selectedIds, onSelect: select });
  const itemMenu = (node: ResourceNode, index: number) => (event: MouseEvent<HTMLElement>) => {
    const targets = rowTargets(node, index);
    if (onRowMenu) { event.preventDefault(); event.stopPropagation(); onRowMenu(targets, { x: event.clientX, y: event.clientY }); }
  };
  const grid = <ul className={`resource-explorer__grid resource-explorer__grid--${viewMode}`} aria-label={koEn("현재 폴더의 파일 목록", "Files in the current folder")}>
    {route.length > 1 ? <li tabIndex={0} className="resource-explorer__item" title={koEn("상위 폴더", "Parent folder")} onDoubleClick={() => setRoute(route.slice(0, -1))} onKeyDown={(e) => { if (e.key === "Enter") setRoute(route.slice(0, -1)); }}><Codicon name="folder" className="resource-icon--folder" /><span className="resource-explorer__item-name">..</span></li> : null}
    {visible.map((node, index) => <li key={node.id} data-index={index} data-resource-id={node.id} tabIndex={0} title={node.name} aria-selected={selectedIds.has(node.id)} className={selectedIds.has(node.id) ? "resource-explorer__item resource-explorer__selected" : "resource-explorer__item"} onClick={(event) => clickRow(event, index)} onContextMenu={itemMenu(node, index)} onDoubleClick={() => open(node)} onKeyDown={(e) => { if (e.key === "Enter") open(node); }}>
      <ResourceIconView node={node} /><span className="resource-explorer__item-name">{node.name}</span>{statusBadge(node)}
    </li>)}
  </ul>;
  const nav = (
    <nav className="resource-explorer__address" aria-label={koEn("현재 폴더 경로", "Current folder path")}>
      {route.map((node, index) => <span className="resource-explorer__breadcrumb" key={node.id}>
        {index > 0 ? <Codicon name="chevron-right" /> : null}
        <button type="button" aria-current={index === route.length - 1 ? "location" : undefined} onClick={() => setRoute(route.slice(0, index + 1))}>{node.name}</button>
      </span>)}
      {addressExtra ? <span className="resource-explorer__address-extra">{addressExtra}</span> : null}
    </nav>
  );
  const pager = (
    <footer className="resource-explorer__pager"><span>{nodes?.filter((node) => node.directory).length ?? 0}{koEn("개 폴더", " folder(s)")} · {nodes?.filter((node) => !node.directory).length ?? 0}{koEn("개 파일", " file(s)")}</span>{pages > 1 ? <><button disabled={page === 0} onClick={() => setPage(page - 1)}>{koEn("이전", "Previous")}</button><span>{page + 1} / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{koEn("다음", "Next")}</button></> : null}</footer>
  );
  return <div className="resource-explorer">
    <div className="resource-explorer__body" ref={body}>
      <aside className="resource-explorer__tree" aria-label={koEn("폴더 탐색", "Folder navigation")} onContextMenu={onTreeContextMenu} style={{ width: layout.sidebarWidth, maxWidth: "50%" }}>
        {sidebarTitle}
        <div className="resource-explorer__tree-body">{sidebar ?? <ResourceTree source={source} selectedId={current.id} expandedPath={expandedPath} rowAction={rowAction} onRowMenu={onRowMenu} directoriesOnly onSelect={(_, ancestors) => setRoute(ancestors)} />}</div>
      </aside>
      <WorkbenchSash orientation="vertical" onPointerDown={(event) => {
        const startX = event.clientX, startWidth = Math.min(layout.sidebarWidth, (body.current?.clientWidth ?? 520) / 2);
        startDrag({ orientation: "vertical", onResize: (x) => LayoutService.setSidebarWidth(Math.min((body.current?.clientWidth ?? 520) / 2, startWidth + x - startX)) });
      }} />
      <div className="resource-explorer__main">
        {header}
        <div className={`resource-explorer__card${nodes !== null && nodes.length === 0 ? " resource-explorer__card--empty" : ""}`}>
          {nav}
      <div className="resource-explorer__list" ref={listRef} onPointerDown={marqueeSelection.onPointerDown} aria-busy={nodes === null && !error} onContextMenu={onListContextMenu} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); select(new Set(visible.map((node) => node.id))); } }}>
        {viewMode !== "details" ? grid : <table aria-label={koEn("현재 폴더의 파일 목록", "Files in the current folder")}><thead><tr>{statusIcons ? <th className="resource-explorer__status-cell" /> : null}<th>{koEn("이름", "Name")}</th>{tableColumns.map((column) => <th key={column.id} className={column.align === "right" ? "resource-explorer__right" : undefined}>{column.title}</th>)}{rowAction ? <th className="resource-explorer__action-cell" /> : null}</tr></thead><tbody>
          {route.length > 1 ? <tr tabIndex={0} onDoubleClick={() => setRoute(route.slice(0, -1))} onKeyDown={(e) => { if (e.key === "Enter") setRoute(route.slice(0, -1)); }}>{statusIcons ? <td className="resource-explorer__status-cell" /> : null}<td className="resource-explorer__name"><Codicon name="folder" />..</td>{tableColumns.map((column) => <td key={column.id}>{column.id === "kind" ? koEn("상위 폴더", "Parent folder") : null}</td>)}{rowAction ? <td /> : null}</tr> : null}
          {visible.map((node, index) => <tr key={node.id} data-index={index} data-resource-id={node.id} tabIndex={0} aria-selected={selectedIds.has(node.id)} className={selectedIds.has(node.id) ? "resource-explorer__selected" : undefined} onClick={(event) => clickRow(event, index)} onContextMenu={(event) => { const targets = rowTargets(node, index); if (onRowMenu) { event.preventDefault(); event.stopPropagation(); onRowMenu(targets, { x: event.clientX, y: event.clientY }); } }} onDoubleClick={() => open(node)} onKeyDown={(e) => { if (e.key === "Enter") open(node); }}>
            {statusIcons ? <td className="resource-explorer__status-cell">{statusBadge(node)}</td> : null}<td className="resource-explorer__name"><ResourceIconView node={node} />{node.name}</td>{tableColumns.map((column) => <td key={column.id} className={column.align === "right" ? "resource-explorer__right" : undefined}>{column.render(node)}</td>)}{rowAction && onRowMenu ? <td className="resource-explorer__action-cell"><button type="button" className="resource-row-action" tabIndex={-1} title={rowAction.title} aria-label={rowAction.title} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onRowMenu(rowTargets(node, index), { x: rect.left, y: rect.bottom + 2 }); }}><Codicon name={rowAction.icon} /></button></td> : null}
          </tr>)}
        </tbody></table>}
        {marqueeSelection.overlay}
        {error ? <div className="resource-explorer__message" role="alert">{error} <button onClick={() => setRevision(revision + 1)}>{koEn("다시 시도", "Retry")}</button></div> : nodes === null ? <div className="resource-explorer__message" role="status">{koEn("불러오는 중…", "Loading…")}</div> : nodes.length === 0 ? <div className="resource-explorer__message">{emptyMessage ?? koEn("이 폴더는 비어 있습니다.", "This folder is empty.")}</div> : null}
      </div>
          {pager}
        </div>
        {footer}
      </div>
    </div>
  </div>;
}
