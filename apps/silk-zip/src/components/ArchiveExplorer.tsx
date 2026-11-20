import { useCallback, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import ResourceExplorer, { type ResourceColumn } from "@silk-studio/workbench/components/explorer/ResourceExplorer.tsx";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import type { ResourceNode } from "@silk-studio/workbench/components/explorer/resourceExplorerTypes.ts";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import type { ArchiveListing } from "../archive";
import { archiveNodePath, createArchiveSource } from "../archiveSource";
import type { ExtractTarget } from "../extractTargets";
import ExtractMenu, { type MenuAnchor } from "./ExtractMenu";
import ViewPaneTitle from "@silk-studio/workbench/components/layout/Sidebar/ViewPaneTitle/ViewPaneTitle.tsx";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";

const columns: readonly ResourceColumn[] = [{ id: "encrypted", title: "암호화", render: (node) => node.encrypted ? "예" : "" }];

interface ArchiveExplorerProps {
  archive: ArchiveListing;
  onExtract: (target: ExtractTarget, entries?: string[]) => void;
}

export default function ArchiveExplorer({ archive, onExtract }: ArchiveExplorerProps) {
  const layout = useLayoutState();
  const source = useMemo(() => createArchiveSource(archive), [archive]);
  const [menu, setMenu] = useState<(MenuAnchor & { selection?: { label: string; paths: string[] } }) | null>(null);
  const selected = useRef<readonly ResourceNode[]>([]);
  const onSelectionChange = useCallback((nodes: readonly ResourceNode[]) => {
    selected.current = nodes;
    ContextKeyService.set("hasArchiveEntrySelection", nodes.length > 0);
  }, []);
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
    setMenu({ x: event.clientX, y: event.clientY, selection: onRow ? currentSelection(selected.current) : undefined });
  };
  const fileName = archive.path.slice(Math.max(archive.path.lastIndexOf("\\"), archive.path.lastIndexOf("/")) + 1);
  const header = (
    <div className="zip-archive-header zip-toolbar">
      <div className="zip-archive-header__text"><h1 title={fileName}>{fileName}</h1><p title={archive.path}>{archive.path}</p></div>
      <div className="zip-toolbar__actions">
        <div className="zip-extract-split">
          <button type="button" className="zip-button zip-extract-split__main" title="압축 풀기 (Ctrl+E)" onClick={() => onExtract("ask")}>압축 풀기</button>
          <button type="button" className="zip-button zip-extract-split__arrow" title="풀기 옵션" aria-label="풀기 옵션" aria-haspopup="menu" aria-expanded={menu !== null} onClick={openMenuBelow}>
            <Codicon name="chevron-down" />
          </button>
        </div>
      </div>
    </div>
  );
  return <section className={`zip-archive-workspace${layout.sidebar ? "" : " zip-archive-workspace--sidebar-hidden"}`} aria-label="압축 파일 탐색기">
    {archive.warnings.map((warning, index) => <p className="zip-message" key={index}>{warning}</p>)}
    <div className="zip-explorer-content" style={{ "--zip-sidebar-width": layout.sidebar ? `${layout.sidebarWidth}px` : "0px" } as CSSProperties}>
      {layout.sidebar ? <div className="zip-explorer-title"><ViewPaneTitle title="탐색기" /></div> : null}
      <ResourceExplorer
        source={source}
        onSelectionChange={onSelectionChange}
        extraColumns={columns}
        header={header}
        onListContextMenu={openContextMenu}
        onTreeContextMenu={openContextMenu}
        rowAction={{ icon: "export", title: "압축 풀기" }}
        onRowMenu={(nodes, at) => setMenu({ ...at, selection: currentSelection(nodes) })}
      />
    </div>
    {menu ? <ExtractMenu archivePath={archive.path} anchor={menu} onClose={closeMenu} selectionLabel={menu.selection?.label} onPick={(target, scope) => { const entries = scope === "selection" && menu.selection ? menu.selection.paths : undefined; setMenu(null); onExtract(target, entries); }} /> : null}
  </section>;
}
