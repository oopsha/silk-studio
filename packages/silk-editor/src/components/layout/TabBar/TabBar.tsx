import { useCallback, useEffect, useRef, useState, type WheelEvent } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { EditorService } from "../../../services/editor/editorService";
import { TabBarActionService } from "../../../services/editor/tabBarActionService";
import { codiconForLanguage } from "../../../services/editor/languageFromPath";
import { useActiveEditor } from "../../../services/editor/useActiveEditor";
import { useEditorTabs } from "../../../services/editor/useEditorTabs";
import TabBarContextMenu from "./TabBarContextMenu";
import TabBarMoreMenu from "./TabBarMoreMenu";
import "./TabBar.css";

type ContextMenuState = {
  tabId: string;
  top: number;
  left: number;
};

export type TabBarCommandAdapter = {
  executeCommand: (commandId: string) => void | Promise<void>;
  lookupKeybinding: (commandId: string) => string | undefined;
};

type TabBarProps = {
  commands: TabBarCommandAdapter;
};

function TabBar({ commands }: TabBarProps) {
  const tabs = useEditorTabs();
  const activeTab = useActiveEditor();
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const moreActionsRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

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

  function handleCloseTab(event: React.MouseEvent, tabId: string) {
    event.stopPropagation();
    EditorService.closeTab(tabId);
  }

  function handleAuxClick(event: React.MouseEvent, tabId: string) {
    if (event.button === 1) {
      event.preventDefault();
      EditorService.closeTab(tabId);
    }
  }

  function toggleMoreMenu() {
    setMoreMenuOpen((open) => !open);
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

            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                className={`tab-bar__tab${isActive ? " tab-bar__tab--active" : ""}${tab.isPreview ? " tab-bar__tab--preview" : ""}${tab.isDirty ? " tab-bar__tab--dirty" : ""}`}
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
                onClick={() => EditorService.setActiveTab(tab.id)}
                onAuxClick={(event) => handleAuxClick(event, tab.id)}
                onDoubleClick={() => {
                  if (tab.isPreview) {
                    EditorService.pinTab(tab.id);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  EditorService.setActiveTab(tab.id);
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
                    aria-label={`Close ${tab.label}`}
                    onClick={(event) => handleCloseTab(event, tab.id)}
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
        <button
          type="button"
          className="tab-bar__action"
          title="Split Editor Right"
          aria-label="Split Editor Right"
          onClick={() =>
            void commands.executeCommand("workbench.action.splitEditorRight")
          }
        >
          <Codicon name="split-horizontal" />
        </button>
        <button
          ref={moreActionsRef}
          type="button"
          className={`tab-bar__action${moreMenuOpen ? " tab-bar__action--open" : ""}`}
          title="More Actions..."
          aria-label="More Actions..."
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
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {moreMenuOpen ? (
        <TabBarMoreMenu
          anchorRef={moreActionsRef}
          commands={commands}
          onClose={() => setMoreMenuOpen(false)}
          onShowOpenEditors={showOpenEditorsMenu}
        />
      ) : null}
    </header>
  );
}

export default TabBar;
