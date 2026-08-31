import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { EditorGroupsService } from "../../../services/editor/editorGroupsService";
import type { EditorGroupId } from "../../../services/editor/editorGroupTypes";
import { TabBarActionService } from "../../../services/editor/tabBarActionService";
import { codiconForLanguage } from "../../../services/editor/languageFromPath";
import { useActiveEditor } from "../../../services/editor/useActiveEditor";
import { useEditorTabs } from "../../../services/editor/useEditorTabs";
import { useEditorGroupsLayout } from "../../../services/editor/useEditorGroupsLayout";
import TabBarContextMenu from "./TabBarContextMenu";
import TabBarMoreMenu from "./TabBarMoreMenu";
import "./TabBar.css";

/** Ignore tiny pointer jitter before starting a reorder drag. */
const DRAG_THRESHOLD_PX = 4;

type ContextMenuState = {
  tabId: string;
  top: number;
  left: number;
};

export type TabBarCommandAdapter = {
  executeCommand: (commandId: string) => void | Promise<void>;
  lookupKeybinding: (commandId: string) => string | undefined;
};

/**
 * Localized strings for the tab bar and its menus. This package cannot depend on
 * @silk-studio/workbench's i18n (workbench already depends on this package, so that
 * would be circular) — the app layer builds these via useI18n() and passes them down.
 */
export type TabBarLabels = {
  showOpenedEditors: string;
  closeAll: string;
  closeSaved: string;
  enablePreviewEditors: string;
  lockGroup: string;
  configureEditors: string;
  close: string;
  closeOthers: string;
  closeToTheRight: string;
  keepOpen: string;
  splitEditorRight: string;
  closeEditorGroup: string;
  moreActions: string;
  closeTabAriaLabel: (tabLabel: string) => string;
};

/**
 * Cross-group drag-to-split, injected from the app layer (silk-editor can't depend on
 * app-specific pane drop-target markers). `updateHover`/`commitDrop` return true when a
 * foreign-pane target is active — TabBar defers to its own same-tabbar reorder logic otherwise.
 */
export type TabBarCrossGroupDnd = {
  updateHover: (
    clientX: number,
    clientY: number,
    sourceGroupId: EditorGroupId,
  ) => boolean;
  commitDrop: (tabId: string, sourceGroupId: EditorGroupId) => boolean;
  cancel: () => void;
};

type TabBarProps = {
  groupId: EditorGroupId;
  commands: TabBarCommandAdapter;
  labels: TabBarLabels;
  crossGroupDnd?: TabBarCrossGroupDnd;
};

type DropIndicator = {
  tabId: string;
  edge: "before" | "after";
};

type PointerDragSession = {
  tabId: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  suppressClick: boolean;
};

/**
 * Pointer-based tab reorder (not HTML5 DnD).
 * Tauri keeps native OS file-drop; HTML5 DnD cannot coexist on Windows WebView2.
 */
function TabBar({ groupId, commands, labels, crossGroupDnd }: TabBarProps) {
  const group = EditorGroupsService.getGroup(groupId);
  const tabs = useEditorTabs(groupId);
  const activeTab = useActiveEditor(groupId);
  const { layout: groupsLayout } = useEditorGroupsLayout();
  const hasMultipleGroups = groupsLayout.type === "split";
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const moreActionsRef = useRef<HTMLButtonElement>(null);
  const dragSessionRef = useRef<PointerDragSession | null>(null);
  const suppressClickRef = useRef(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [locked, setLocked] = useState(() =>
    EditorGroupsService.isGroupLocked(groupId),
  );
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(
    null,
  );

  const showOpenEditorsMenu = useCallback(() => {
    setMoreMenuOpen(false);
    TabBarActionService.requestShowOpenEditors();
  }, []);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const container = tabsContainerRef.current;
    if (!container || event.deltaY === 0) return;
    container.scrollLeft += event.deltaY;
    event.preventDefault();
  }, []);

  useEffect(() => {
    if (!activeTab) return;
    const container = tabsContainerRef.current;
    const activeElement = container?.querySelector<HTMLElement>(
      `[data-tab-id="${activeTab.id}"]`,
    );
    activeElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab?.id]);

  useEffect(() => {
    setLocked(EditorGroupsService.isGroupLocked(groupId));
    return EditorGroupsService.onDidChangeAnyGroup(() => {
      setLocked(EditorGroupsService.isGroupLocked(groupId));
    });
  }, [groupId]);

  const clearDragVisuals = useCallback(() => {
    setDraggingTabId(null);
    setDropIndicator(null);
  }, []);

  const resolveIndicatorAtPoint = useCallback(
    (clientX: number, sourceId: string): DropIndicator | null => {
      const container = tabsContainerRef.current;
      const currentTabs = tabsRef.current;
      if (!container || currentTabs.length === 0) return null;

      const tabElements = Array.from(
        container.querySelectorAll<HTMLElement>("[data-tab-id]"),
      );
      if (tabElements.length === 0) return null;

      const firstRect = tabElements[0].getBoundingClientRect();
      const lastRect =
        tabElements[tabElements.length - 1].getBoundingClientRect();

      if (clientX <= firstRect.left) {
        return { tabId: currentTabs[0].id, edge: "before" };
      }
      if (clientX >= lastRect.right) {
        return {
          tabId: currentTabs[currentTabs.length - 1].id,
          edge: "after",
        };
      }

      for (const el of tabElements) {
        const tabId = el.dataset.tabId;
        if (!tabId || tabId === sourceId) continue;
        const rect = el.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right) continue;
        const mid = rect.left + rect.width / 2;
        return {
          tabId,
          edge: clientX < mid ? "before" : "after",
        };
      }

      return null;
    },
    [],
  );

  const commitReorder = useCallback(
    (sourceId: string, indicator: DropIndicator) => {
      const currentTabs = tabsRef.current;
      const fromIndex = currentTabs.findIndex((tab) => tab.id === sourceId);
      const targetIndex = currentTabs.findIndex(
        (tab) => tab.id === indicator.tabId,
      );
      if (fromIndex === -1 || targetIndex === -1) return;

      let toIndex =
        indicator.edge === "before" ? targetIndex : targetIndex + 1;
      if (fromIndex < toIndex) {
        toIndex -= 1;
      }

      group.moveTab(sourceId, toIndex);
      group.setActiveTab(sourceId);
    },
    [group],
  );

  const endPointerDrag = useCallback(
    (session: PointerDragSession, clientX: number) => {
      if (session.active) {
        suppressClickRef.current = true;
        const consumedByForeignPane =
          crossGroupDnd?.commitDrop(session.tabId, groupId) ?? false;
        if (!consumedByForeignPane) {
          const indicator = resolveIndicatorAtPoint(clientX, session.tabId);
          if (indicator) {
            commitReorder(session.tabId, indicator);
          }
        }
      } else {
        crossGroupDnd?.cancel();
      }
      dragSessionRef.current = null;
      clearDragVisuals();
    },
    [clearDragVisuals, commitReorder, crossGroupDnd, groupId, resolveIndicatorAtPoint],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      if (
        !session.active &&
        dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
      ) {
        session.active = true;
        session.suppressClick = true;
        setDraggingTabId(session.tabId);
      }

      if (!session.active) return;

      event.preventDefault();
      const overForeignPane =
        crossGroupDnd?.updateHover(event.clientX, event.clientY, groupId) ??
        false;
      // A foreign pane's overlay is showing — don't also draw this tab bar's
      // own same-tabbar insertion line at whatever position the pointer left it.
      setDropIndicator(
        overForeignPane
          ? null
          : resolveIndicatorAtPoint(event.clientX, session.tabId),
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      endPointerDrag(session, event.clientX);
    };

    const onPointerCancel = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      crossGroupDnd?.cancel();
      dragSessionRef.current = null;
      clearDragVisuals();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [
    clearDragVisuals,
    crossGroupDnd,
    endPointerDrag,
    groupId,
    resolveIndicatorAtPoint,
  ]);

  function handleCloseTab(event: React.MouseEvent, tabId: string) {
    event.stopPropagation();
    EditorGroupsService.closeTab(groupId, tabId);
  }

  function handleAuxClick(event: React.MouseEvent, tabId: string) {
    if (event.button === 1) {
      event.preventDefault();
      EditorGroupsService.closeTab(groupId, tabId);
    }
  }

  function toggleMoreMenu() {
    setMoreMenuOpen((open) => !open);
  }

  function handleTabPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    tabId: string,
  ) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".tab-bar__close")) return;

    dragSessionRef.current = {
      tabId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      suppressClick: false,
    };
  }

  function handleTabClick(tabId: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    group.setActiveTab(tabId);
  }

  return (
    <header className="tab-bar">
      <div
        ref={tabsContainerRef}
        className="tab-bar__tabs-container"
        onWheel={handleWheel}
      >
        <div className="tab-bar__tabs" role="tablist">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            const dropBefore =
              dropIndicator?.tabId === tab.id &&
              dropIndicator.edge === "before";
            const dropAfter =
              dropIndicator?.tabId === tab.id && dropIndicator.edge === "after";

            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                className={`tab-bar__tab${isActive ? " tab-bar__tab--active" : ""}${tab.isPreview ? " tab-bar__tab--preview" : ""}${tab.isDirty ? " tab-bar__tab--dirty" : ""}${draggingTabId === tab.id ? " tab-bar__tab--dragging" : ""}${dropBefore ? " tab-bar__tab--drop-before" : ""}${dropAfter ? " tab-bar__tab--drop-after" : ""}`}
                role="tab"
                aria-selected={isActive}
                title={
                  tab.tooltip ??
                  (tab.description
                    ? `${tab.label} — ${tab.description}${
                        tab.uri ? `\n${tab.uri}` : ""
                      }`
                    : (tab.uri ?? tab.label))
                }
                onPointerDown={(event) => handleTabPointerDown(event, tab.id)}
                onClick={() => handleTabClick(tab.id)}
                onAuxClick={(event) => handleAuxClick(event, tab.id)}
                onDoubleClick={() => {
                  if (tab.isPreview) {
                    group.pinTab(tab.id);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  group.setActiveTab(tab.id);
                  setMoreMenuOpen(false);
                  setContextMenu({
                    tabId: tab.id,
                    top: event.clientY,
                    left: event.clientX,
                  });
                }}
              >
                <span className="tab-bar__tab-icon" aria-hidden>
                  <Codicon
                    name={
                      tab.uri === "silk://settings"
                        ? "settings-gear"
                        : codiconForLanguage(tab.languageId)
                    }
                  />
                </span>
                <span className="tab-bar__tab-label">{tab.label}</span>
                {tab.description ? (
                  <span className="tab-bar__tab-description">
                    {tab.description}
                  </span>
                ) : null}
                <span className="tab-bar__tab-actions">
                  {tab.isDirty ? (
                    <span className="tab-bar__dirty-indicator" aria-hidden />
                  ) : null}
                  <button
                    type="button"
                    className="tab-bar__close"
                    aria-label={labels.closeTabAriaLabel(tab.label)}
                    onClick={(event) => handleCloseTab(event, tab.id)}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Codicon name="close" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="tab-bar__actions">
        {locked ? (
          <button
            type="button"
            className="tab-bar__action"
            title={labels.lockGroup}
            aria-label={labels.lockGroup}
            onClick={() => {
              EditorGroupsService.setFocusedGroup(groupId);
              EditorGroupsService.toggleGroupLock(groupId);
            }}
          >
            <Codicon name="lock" />
          </button>
        ) : null}
        {!hasMultipleGroups ? (
          <button
            type="button"
            className="tab-bar__action"
            title={labels.splitEditorRight}
            aria-label={labels.splitEditorRight}
            onClick={() => {
              // The command reads the focused group — make sure it's this pane's,
              // even if the user clicked the button without focusing the pane first.
              EditorGroupsService.setFocusedGroup(groupId);
              void commands.executeCommand("workbench.action.splitEditorRight");
            }}
          >
            <Codicon name="split-horizontal" />
          </button>
        ) : (
          <button
            type="button"
            className="tab-bar__action"
            title={labels.closeEditorGroup}
            aria-label={labels.closeEditorGroup}
            onClick={() => {
              EditorGroupsService.setFocusedGroup(groupId);
              void commands.executeCommand("workbench.action.closeEditorGroup");
            }}
          >
            <Codicon name="close-all" />
          </button>
        )}
        <button
          ref={moreActionsRef}
          type="button"
          className={`tab-bar__action${moreMenuOpen ? " tab-bar__action--open" : ""}`}
          title={labels.moreActions}
          aria-label={labels.moreActions}
          aria-expanded={moreMenuOpen}
          aria-haspopup="menu"
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleMoreMenu}
        >
          <Codicon name="ellipsis" />
        </button>
      </div>

      {contextMenu ? (
        <TabBarContextMenu
          tabId={contextMenu.tabId}
          anchor={{ top: contextMenu.top, left: contextMenu.left }}
          commands={commands}
          labels={labels}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {moreMenuOpen ? (
        <TabBarMoreMenu
          anchorRef={moreActionsRef}
          groupId={groupId}
          commands={commands}
          labels={labels}
          onClose={() => setMoreMenuOpen(false)}
          onShowOpenEditors={showOpenEditorsMenu}
        />
      ) : null}
    </header>
  );
}

export default TabBar;
