import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import WorkbenchSash from "../layout/WorkbenchSash";
import { useWorkbenchSashDrag } from "../../services/layout/useWorkbenchSashDrag";
import { LayoutService } from "../../services/layout/layoutService";
import { useLayoutState } from "../../services/layout/useLayoutState";
import ResourceTree from "./ResourceTree";
import { resourceIcon, sortResources, type ResourceNode, type ResourceSource } from "./resourceExplorerTypes";
import "./ResourceExplorer.css";

export type ResourceColumn = { id: string; title: string; render: (node: ResourceNode) => ReactNode };
type Props = {
  source: ResourceSource;
  onOpenFile?: (node: ResourceNode) => void;
  onSelectionChange?: (node: ResourceNode | null) => void;
  extraColumns?: readonly ResourceColumn[];
};

export default function ResourceExplorer({ source, onOpenFile, onSelectionChange, extraColumns = [] }: Props) {
  const [route, setRoute] = useState<readonly ResourceNode[]>([source.root]);
  const [nodes, setNodes] = useState<readonly ResourceNode[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const expandedPath = useMemo(() => route.slice(0, -1).map((node) => node.id), [route]);
  const layout = useLayoutState();
  const { startDrag } = useWorkbenchSashDrag();
  const body = useRef<HTMLDivElement>(null);
  const current = route[route.length - 1];
  useEffect(() => { setRoute([source.root]); }, [source]);
  useEffect(() => {
    let active = true;
    setNodes(null); setError(""); setPage(0); setSelectedId(""); onSelectionChange?.(null);
    Promise.resolve().then(() => source.readChildren(current.id)).then((children) => {
      if (active) setNodes(sortResources(children));
    }).catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [source, current.id, revision, onSelectionChange]);
  const open = (node: ResourceNode) => node.directory ? setRoute([...route, node]) : onOpenFile?.(node);
  const pages = Math.max(1, Math.ceil((nodes?.length ?? 0) / 500));
  return <div className="resource-explorer">
    <nav className="resource-explorer__address" aria-label="현재 폴더 경로">
      {route.map((node, index) => <span className="resource-explorer__breadcrumb" key={node.id}>
        {index > 0 ? <Codicon name="chevron-right" /> : null}
        <button type="button" aria-current={index === route.length - 1 ? "location" : undefined} onClick={() => setRoute(route.slice(0, index + 1))}>{node.name}</button>
      </span>)}
    </nav>
    <div className="resource-explorer__body" ref={body}>
      <aside className="resource-explorer__tree" aria-label="폴더 탐색" style={{ width: layout.sidebarWidth, maxWidth: "50%" }}>
        <ResourceTree source={source} selectedId={current.id} expandedPath={expandedPath} directoriesOnly onSelect={(_, ancestors) => setRoute(ancestors)} />
      </aside>
      <WorkbenchSash orientation="vertical" onPointerDown={(event) => {
        const startX = event.clientX, startWidth = Math.min(layout.sidebarWidth, (body.current?.clientWidth ?? 520) / 2);
        startDrag({ orientation: "vertical", onResize: (x) => LayoutService.setSidebarWidth(Math.min((body.current?.clientWidth ?? 520) / 2, startWidth + x - startX)) });
      }} />
      <div className="resource-explorer__list" aria-busy={nodes === null && !error}>
        <table aria-label="현재 폴더의 파일 목록"><thead><tr><th>이름</th><th>종류</th><th>크기</th>{extraColumns.map((column) => <th key={column.id}>{column.title}</th>)}</tr></thead><tbody>
          {route.length > 1 ? <tr tabIndex={0} onDoubleClick={() => setRoute(route.slice(0, -1))} onKeyDown={(e) => { if (e.key === "Enter") setRoute(route.slice(0, -1)); }}><td className="resource-explorer__name"><Codicon name="folder" />..</td><td>상위 폴더</td><td />{extraColumns.map((column) => <td key={column.id} />)}</tr> : null}
          {(nodes ?? []).slice(page * 500, (page + 1) * 500).map((node) => <tr key={node.id} tabIndex={0} className={selectedId === node.id ? "resource-explorer__selected" : undefined} onClick={() => { setSelectedId(node.id); onSelectionChange?.(node); }} onDoubleClick={() => open(node)} onKeyDown={(e) => { if (e.key === "Enter") open(node); }}>
            <td className="resource-explorer__name"><Codicon {...resourceIcon(node)} />{node.name}</td><td>{node.directory ? "폴더" : "파일"}</td><td>{node.directory || node.size == null ? "—" : `${node.size.toLocaleString()} B`}</td>{extraColumns.map((column) => <td key={column.id}>{column.render(node)}</td>)}
          </tr>)}
        </tbody></table>
        {error ? <div className="resource-explorer__message" role="alert">{error} <button onClick={() => setRevision(revision + 1)}>다시 시도</button></div> : nodes === null ? <div className="resource-explorer__message" role="status">불러오는 중…</div> : nodes.length === 0 ? <div className="resource-explorer__message">이 폴더는 비어 있습니다.</div> : null}
      </div>
    </div>
    <footer className="resource-explorer__pager"><span>{nodes?.filter((node) => node.directory).length ?? 0}개 폴더 · {nodes?.filter((node) => !node.directory).length ?? 0}개 파일</span>{pages > 1 ? <><button disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button><span>{page + 1} / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>다음</button></> : null}</footer>
  </div>;
}
