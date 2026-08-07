import { Fragment, useRef, type ReactNode } from "react";
import type { Monaco } from "@monaco-editor/react";
import TabBar from "@silk-studio/editor/components/layout/TabBar/index.ts";
import type { TabBarCommandAdapter } from "@silk-studio/editor/components/layout/TabBar/TabBar.tsx";
import EditorArea from "@silk-studio/editor/components/layout/EditorArea/index.ts";
import type { EditorConfigurationOptions } from "@silk-studio/editor/components/layout/EditorArea/EditorArea.tsx";
import type { EditorTab } from "@silk-studio/editor/services/editor/editorTypes.ts";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import { useEditorGroupsLayout } from "@silk-studio/editor/services/editor/useEditorGroupsLayout.ts";
import type {
  EditorGroupId,
  EditorLayoutNode,
} from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import WorkbenchSash from "@silk-studio/workbench/components/layout/WorkbenchSash/index.ts";
import { useWorkbenchSashDrag } from "@silk-studio/workbench/services/layout/useWorkbenchSashDrag.ts";
import {
  SILK_EDITOR_DROP_ATTR,
  SILK_EDITOR_DROP_GROUP_ATTR,
} from "../../../services/dnd/explorerObjectDrag.ts";
import "./EditorGroupsView.css";

type EditorAreaSharedProps = {
  configuration: EditorConfigurationOptions;
  beforeMount?: (monaco: Monaco) => void;
  renderAlternative?: (tab: EditorTab) => React.ReactNode | null;
  onRunQuery?: () => void;
  onRunScript?: () => void;
};

type StartDrag = ReturnType<typeof useWorkbenchSashDrag>["startDrag"];

type EditorGroupsViewProps = {
  commands: TabBarCommandAdapter;
  editorProps: EditorAreaSharedProps;
};

/** Minimum ratio either side of a sash can shrink to. */
const MIN_PANE_RATIO = 0.15;

function EditorGroupsView({ commands, editorProps }: EditorGroupsViewProps) {
  const { layout, focusedGroupId } = useEditorGroupsLayout();
  const { startDrag } = useWorkbenchSashDrag();
  // Only draw the focus ring once there's something to distinguish between.
  const showFocusRing = layout.type === "split";

  return (
    <>
      {renderLayoutNode(
        layout,
        focusedGroupId,
        showFocusRing,
        commands,
        editorProps,
        startDrag,
      )}
    </>
  );
}

function renderLayoutNode(
  node: EditorLayoutNode,
  focusedGroupId: EditorGroupId,
  showFocusRing: boolean,
  commands: TabBarCommandAdapter,
  editorProps: EditorAreaSharedProps,
  startDrag: StartDrag,
): ReactNode {
  if (node.type === "group") {
    return (
      <EditorGroupPane
        key={node.id}
        groupId={node.id}
        isFocused={node.id === focusedGroupId}
        showFocusRing={showFocusRing}
        commands={commands}
        editorProps={editorProps}
      />
    );
  }

  return (
    <EditorSplitPane
      key={node.id}
      node={node}
      focusedGroupId={focusedGroupId}
      showFocusRing={showFocusRing}
      commands={commands}
      editorProps={editorProps}
      startDrag={startDrag}
    />
  );
}

function EditorGroupPane({
  groupId,
  isFocused,
  showFocusRing,
  commands,
  editorProps,
}: {
  groupId: EditorGroupId;
  isFocused: boolean;
  showFocusRing: boolean;
  commands: TabBarCommandAdapter;
  editorProps: EditorAreaSharedProps;
}) {
  return (
    <div
      className={`editor-groups-pane${isFocused && showFocusRing ? " editor-groups-pane--focused" : ""}`}
      {...{
        [SILK_EDITOR_DROP_ATTR]: "",
        [SILK_EDITOR_DROP_GROUP_ATTR]: groupId,
      }}
      onPointerDownCapture={() => EditorGroupsService.setFocusedGroup(groupId)}
    >
      <TabBar groupId={groupId} commands={commands} />
      <EditorArea groupId={groupId} isFocusedGroup={isFocused} {...editorProps} />
    </div>
  );
}

function EditorSplitPane({
  node,
  focusedGroupId,
  showFocusRing,
  commands,
  editorProps,
  startDrag,
}: {
  node: Extract<EditorLayoutNode, { type: "split" }>;
  focusedGroupId: EditorGroupId;
  showFocusRing: boolean;
  commands: TabBarCommandAdapter;
  editorProps: EditorAreaSharedProps;
  startDrag: StartDrag;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isRow = node.direction === "row";

  function handleSashPointerDown(childIndex: number) {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const totalSize = isRow ? rect.width : rect.height;
    const edge = isRow ? rect.left : rect.top;
    if (totalSize <= 0) return;

    // The sash between children[childIndex - 1] and children[childIndex]
    // redistributes ratio only between those two neighbors.
    const a = childIndex - 1;
    const b = childIndex;
    const startSizes = node.sizes;
    const startA = startSizes[a] ?? 1 / node.children.length;
    const startB = startSizes[b] ?? 1 / node.children.length;

    startDrag({
      orientation: isRow ? "vertical" : "horizontal",
      onResize: (clientPosition) => {
        const distanceFromEdge = clientPosition - edge;
        const priorRatioSum = startSizes
          .slice(0, a)
          .reduce((sum, size) => sum + size, 0);
        const rawA = distanceFromEdge / totalSize - priorRatioSum;

        const pairTotal = startA + startB;
        let nextA = Math.min(Math.max(rawA, MIN_PANE_RATIO), pairTotal - MIN_PANE_RATIO);
        if (!Number.isFinite(nextA)) return;
        let nextB = pairTotal - nextA;

        const nextSizes = [...startSizes];
        nextSizes[a] = nextA;
        nextSizes[b] = nextB;
        EditorGroupsService.setSplitRatio(node.id, nextSizes);
      },
    });
  }

  return (
    <div
      ref={containerRef}
      className="editor-groups-split"
      data-direction={node.direction}
    >
      {node.children.map((child, index) => {
        const size = node.sizes[index] ?? 1 / node.children.length;
        return (
          <Fragment key={child.id}>
            {index > 0 ? (
              <WorkbenchSash
                orientation={isRow ? "vertical" : "horizontal"}
                onPointerDown={() => handleSashPointerDown(index)}
              />
            ) : null}
            <div
              className="editor-groups-split__child"
              style={{ flex: `${size} 1 0%` }}
            >
              {renderLayoutNode(
                child,
                focusedGroupId,
                showFocusRing,
                commands,
                editorProps,
                startDrag,
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export default EditorGroupsView;
