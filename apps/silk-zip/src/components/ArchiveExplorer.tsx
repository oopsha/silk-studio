import { useCallback, useMemo, type CSSProperties } from "react";
import ResourceExplorer, { type ResourceColumn } from "@silk-studio/workbench/components/explorer/ResourceExplorer.tsx";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import type { ResourceNode } from "@silk-studio/workbench/components/explorer/resourceExplorerTypes.ts";
import type { ArchiveListing } from "../archive";
import { createArchiveSource } from "../archiveSource";
import ViewPaneTitle from "@silk-studio/workbench/components/layout/Sidebar/ViewPaneTitle/ViewPaneTitle.tsx";
import { useLayoutState } from "@silk-studio/workbench/services/layout/useLayoutState.ts";

const columns: readonly ResourceColumn[] = [{ id: "encrypted", title: "암호화", render: (node) => node.encrypted ? "예" : "" }];

export default function ArchiveExplorer({ archive }: { archive: ArchiveListing }) {
  const layout = useLayoutState();
  const source = useMemo(() => createArchiveSource(archive), [archive]);
  const onSelectionChange = useCallback((node: ResourceNode | null) => {
    ContextKeyService.set("hasArchiveEntrySelection", node !== null);
  }, []);
  return <section className={`zip-archive-workspace${layout.sidebar ? "" : " zip-archive-workspace--sidebar-hidden"}`} aria-label="압축 파일 탐색기">
    {archive.warnings.map((warning, index) => <p className="zip-message" key={index}>{warning}</p>)}
    <div className="zip-explorer-content" style={{ "--zip-sidebar-width": layout.sidebar ? `${layout.sidebarWidth}px` : "0px" } as CSSProperties}>
      {layout.sidebar ? <div className="zip-explorer-title"><ViewPaneTitle title="탐색기" /></div> : null}
      <ResourceExplorer source={source} onSelectionChange={onSelectionChange} extraColumns={columns} />
    </div>
  </section>;
}
