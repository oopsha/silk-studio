import { useMemo, useRef, useState, type ReactNode } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { CommandService } from "../../../../../platform/commands/commandService";
import { useI18n } from "../../../../../platform/i18n/useI18n";
import type { MessageKey } from "../../../../../platform/i18n/translate";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import { useEditorGroupsLayout } from "@silk-studio/editor/services/editor/useEditorGroupsLayout.ts";
import {
  collectGroupIds,
  type EditorGroupId,
} from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import { codiconForLanguage } from "@silk-studio/editor/services/editor/languageFromPath.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { useEditorTabs } from "@silk-studio/editor/services/editor/useEditorTabs.ts";
import AccordionPanel from "../../AccordionPanel/AccordionPanel";
import { PaneSash, useResizablePanes } from "../../PaneView";
import ViewPaneTitle from "../../ViewPaneTitle/ViewPaneTitle";
import ViewsVisibilityMenu, {
  type ViewsVisibilityItem,
} from "../../ViewsVisibilityMenu/ViewsVisibilityMenu";
import OutlineSectionActions from "./OutlineSectionActions";
import TimelineSectionActions from "./TimelineSectionActions";
import "./ExplorerView.css";

type ExplorerSectionId = "openEditors" | "workspace" | "outline" | "timeline";

type ExplorerViewProps = {
  renderConnections?: () => ReactNode;
  connectionsTitle?: string;
  connectionsActions?: ReactNode;
  renderOutline?: () => ReactNode;
  renderTimeline?: () => ReactNode;
};

type ExplorerSegment =
  | { type: "openEditors"; expanded: boolean }
  | { type: "collapsed"; id: ExplorerSectionId }
  | { type: "resizableRun"; ids: ExplorerSectionId[] };

const SECTION_ORDER: ExplorerSectionId[] = [
  "openEditors",
  "workspace",
  // Outline/Timeline temporarily disabled — see the matching comment on VIEW_MENU_DEFS below.
  // "outline",
  // "timeline",
];

const OPEN_EDITORS_ACTION_DEFS = [
  {
    icon: "new-file",
    labelKey: "workbench.sidebar.newUntitled" as const,
    command: "silk.file.newTextFile",
  },
  {
    icon: "save-all",
    labelKey: "workbench.sidebar.saveAll" as const,
    command: "silk.file.saveAll",
  },
  {
    icon: "close-all",
    labelKey: "workbench.sidebar.closeAll" as const,
    command: "silk.file.closeAll",
  },
];

const VIEW_MENU_DEFS: {
  id: ExplorerSectionId;
  labelKey: MessageKey;
  canToggle: boolean;
}[] = [
  {
    id: "openEditors",
    labelKey: "workbench.sidebar.openEditors",
    canToggle: true,
  },
  {
    id: "workspace",
    labelKey: "workbench.sidebar.connections",
    canToggle: false,
  },
  // Outline/Timeline sections are disabled for now — removed from SECTION_ORDER above (so they
  // never render) and from this list (so they don't show up in the Views-and-More-Actions
  // toggle menu either). The section-render branches in renderResizableSection() below are left
  // in place, unreachable, to make re-enabling this a two-line uncomment.
  // { id: "outline", labelKey: "workbench.sidebar.outline", canToggle: true },
  // { id: "timeline", labelKey: "workbench.sidebar.timeline", canToggle: true },
];

function buildSegments(
  visible: Record<ExplorerSectionId, boolean>,
  expanded: Record<ExplorerSectionId, boolean>,
): ExplorerSegment[] {
  const segments: ExplorerSegment[] = [];
  let run: ExplorerSectionId[] = [];

  function flushRun() {
    if (run.length > 0) {
      segments.push({ type: "resizableRun", ids: [...run] });
      run = [];
    }
  }

  for (const id of SECTION_ORDER) {
    if (!visible[id]) continue;

    if (id === "openEditors") {
      flushRun();
      segments.push({ type: "openEditors", expanded: expanded.openEditors });
      continue;
    }

    if (!expanded[id]) {
      flushRun();
      segments.push({ type: "collapsed", id });
      continue;
    }

    run.push(id);
  }

  flushRun();
  return segments;
}

function renderSectionActions(
  actions: ReadonlyArray<{ icon: string; label: string; command?: string }>,
) {
  return (
    <>
      {actions.map((action) => (
        <button
          key={action.icon}
          type="button"
          className="accordion-panel__action"
          title={action.label}
          aria-label={action.label}
          onClick={
            action.command
              ? () => void CommandService.executeCommand(action.command!)
              : undefined
          }
        >
          <Codicon name={action.icon} />
        </button>
      ))}
    </>
  );
}

function OpenEditorsGroupSection({
  groupId,
  groupIndex,
  showHeader,
  isFocused,
}: {
  groupId: EditorGroupId;
  groupIndex: number;
  showHeader: boolean;
  isFocused: boolean;
}) {
  const { t } = useI18n();
  const tabs = useEditorTabs(groupId);
  const activeTab = useActiveEditor(groupId);

  return (
    <>
      {showHeader ? (
        <li
          className={`open-editors-list__group-header${isFocused ? " open-editors-list__group-header--focused" : ""}`}
        >
          {t("workbench.sidebar.openEditorsGroup").replace(
            "{n}",
            String(groupIndex),
          )}
        </li>
      ) : null}
      {tabs.length === 0 && !showHeader ? (
        <li className="accordion-panel__empty">
          {t("workbench.sidebar.noOpenEditors")}
        </li>
      ) : null}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab?.id;

        return (
          <li
            key={tab.id}
            className={`open-editors-list__item${isActive ? " open-editors-list__item--active" : ""}${tab.isDirty ? " open-editors-list__item--dirty" : ""}${tab.isPreview ? " open-editors-list__item--preview" : ""}`}
            title={tab.uri ?? tab.label}
            onClick={() => {
              // Clicking a tab in an unfocused group's section must focus
              // that group too, not just activate the tab within it.
              EditorGroupsService.setFocusedGroup(groupId);
              EditorGroupsService.getGroup(groupId).setActiveTab(tab.id);
            }}
          >
            <span className="open-editors-list__icon" aria-hidden>
              <Codicon name={codiconForLanguage(tab.languageId)} />
            </span>
            <span className="open-editors-list__label">{tab.label}</span>
            {tab.isDirty ? (
              <span className="open-editors-list__dirty" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </>
  );
}

function OpenEditorsList() {
  const { layout, focusedGroupId } = useEditorGroupsLayout();
  const groupIds = useMemo(() => collectGroupIds(layout), [layout]);
  const showHeaders = groupIds.length > 1;

  return (
    <ul className="open-editors-list">
      {groupIds.map((groupId, index) => (
        <OpenEditorsGroupSection
          key={groupId}
          groupId={groupId}
          groupIndex={index + 1}
          showHeader={showHeaders}
          isFocused={groupId === focusedGroupId}
        />
      ))}
    </ul>
  );
}

function ExplorerView({
  renderConnections,
  connectionsTitle,
  connectionsActions,
  renderOutline,
  renderTimeline,
}: ExplorerViewProps) {
  const { t, locale } = useI18n();
  const resolvedConnectionsTitle =
    connectionsTitle ?? t("workbench.sidebar.connections");
  const viewsMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [viewsMenuOpen, setViewsMenuOpen] = useState(false);
  const [outlineMenuOpen, setOutlineMenuOpen] = useState(false);
  const [timelineMenuOpen, setTimelineMenuOpen] = useState(false);
  const suppressAccordionActionHover =
    viewsMenuOpen || outlineMenuOpen || timelineMenuOpen;
  const [expanded, setExpanded] = useState<Record<ExplorerSectionId, boolean>>({
    openEditors: true,
    workspace: true,
    outline: false,
    timeline: false,
  });
  const [visible, setVisible] = useState<Record<ExplorerSectionId, boolean>>({
    openEditors: true,
    workspace: true,
    outline: true,
    timeline: true,
  });

  const segments = useMemo(
    () => buildSegments(visible, expanded),
    [visible, expanded],
  );

  const expandedResizableIds = useMemo(
    () =>
      segments
        .filter(
          (segment): segment is Extract<ExplorerSegment, { type: "resizableRun" }> =>
            segment.type === "resizableRun",
        )
        .flatMap((segment) => segment.ids),
    [segments],
  );

  const { getBodyHeight, startResize, paneHeaderHeight } = useResizablePanes({
    paneIds: expandedResizableIds,
    defaultBodyHeights: {
      workspace: 180,
      outline: 120,
    },
  });

  const viewsMenuItems = useMemo<ViewsVisibilityItem[]>(
    () =>
      VIEW_MENU_DEFS.map((item) => ({
        id: item.id,
        label:
          item.id === "workspace"
            ? resolvedConnectionsTitle
            : t(item.labelKey),
        canToggle: item.canToggle,
        visible: visible[item.id],
      })),
    [visible, t, locale, resolvedConnectionsTitle],
  );

  function toggleSection(sectionId: ExplorerSectionId) {
    setExpanded((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  function toggleSectionVisibility(sectionId: string) {
    const id = sectionId as ExplorerSectionId;
    const menuItem = VIEW_MENU_DEFS.find((item) => item.id === id);
    if (!menuItem?.canToggle) return;

    setVisible((current) => ({
      ...current,
      [id]: !current[id],
    }));
  }

  const openEditorsActions = renderSectionActions(
    OPEN_EDITORS_ACTION_DEFS.map((action) => ({
      icon: action.icon,
      label: t(action.labelKey),
      command: action.command,
    })),
  );
  const WORKSPACE_ACTIONS_NODE = connectionsActions;

  function sectionTitle(id: ExplorerSectionId) {
    const titles: Record<ExplorerSectionId, string> = {
      openEditors: t("workbench.sidebar.openEditors"),
      workspace: resolvedConnectionsTitle,
      outline: t("workbench.sidebar.outline"),
      timeline: t("workbench.sidebar.timeline"),
    };
    return titles[id];
  }

  function renderResizableSection(id: ExplorerSectionId) {
    switch (id) {
      case "workspace":
        return (
          <AccordionPanel
            title={resolvedConnectionsTitle}
            expanded
            variant="fill"
            onToggle={() => toggleSection("workspace")}
            actions={WORKSPACE_ACTIONS_NODE}
          >
            {renderConnections ? (
              renderConnections()
            ) : (
              <div className="accordion-panel__empty">
                {t("workbench.sidebar.noConnections")}
              </div>
            )}
          </AccordionPanel>
        );
      case "outline":
        return (
          <AccordionPanel
            title={t("workbench.sidebar.outline")}
            expanded
            variant="fill"
            onToggle={() => toggleSection("outline")}
            actions={
              <OutlineSectionActions onMenuOpenChange={setOutlineMenuOpen} />
            }
          >
            {renderOutline ? (
              renderOutline()
            ) : (
              <div className="accordion-panel__empty">
                {t("workbench.sidebar.outlineEmpty")}
              </div>
            )}
          </AccordionPanel>
        );
      case "timeline":
        return (
          <AccordionPanel
            title={t("workbench.sidebar.timeline")}
            expanded
            variant="fill"
            onToggle={() => toggleSection("timeline")}
            actions={
              <TimelineSectionActions onMenuOpenChange={setTimelineMenuOpen} />
            }
          >
            {renderTimeline ? (
              renderTimeline()
            ) : (
              <div className="accordion-panel__empty">
                {t("workbench.sidebar.timelineEmpty")}
              </div>
            )}
          </AccordionPanel>
        );
      default:
        return null;
    }
  }

  function segmentFlexes(index: number) {
    const segment = segments[index];
    if (segment.type !== "resizableRun") return false;

    return !segments
      .slice(index + 1)
      .some((next) => next.type === "resizableRun");
  }

  function renderSegment(segment: ExplorerSegment, index: number) {
    const fillsRemaining = segmentFlexes(index);

    if (segment.type === "openEditors") {
      return (
        <div
          key="openEditors"
          className="explorer-view__segment explorer-view__segment--fixed"
        >
          <AccordionPanel
            title={t("workbench.sidebar.openEditors")}
            expanded={segment.expanded}
            variant="fixed"
            onToggle={() => toggleSection("openEditors")}
            actions={openEditorsActions}
          >
            {segment.expanded ? (
              <OpenEditorsList />
            ) : null}
          </AccordionPanel>
        </div>
      );
    }

    if (segment.type === "collapsed") {
      return (
        <div
          key={segment.id}
          className="explorer-view__segment explorer-view__segment--collapsed"
        >
          <AccordionPanel
            title={sectionTitle(segment.id)}
            expanded={false}
            onToggle={() => toggleSection(segment.id)}
            actions={segment.id === "workspace" ? WORKSPACE_ACTIONS_NODE : undefined}
          />
        </div>
      );
    }

    const runKey = segment.ids.join("-");

    return (
      <div
        key={runKey}
        className={`explorer-view__segment explorer-view__resize-stack${fillsRemaining ? " explorer-view__resize-stack--flex" : ""}`}
      >
        {segment.ids.map((id, runIndex) => {
          const isLastInRun = runIndex === segment.ids.length - 1;
          const nextId = segment.ids[runIndex + 1];
          const useFlex = fillsRemaining && isLastInRun;

          return (
            <div key={id} className="explorer-view__pane-group">
              <div
                className={`explorer-view__pane${useFlex ? " explorer-view__pane--flex" : ""}`}
                style={
                  useFlex
                    ? undefined
                    : { height: paneHeaderHeight + getBodyHeight(id) }
                }
              >
                {renderResizableSection(id)}
              </div>
              {nextId ? (
                <PaneSash
                  onPointerDown={(event) =>
                    startResize(
                      id,
                      nextId,
                      nextId === segment.ids[segment.ids.length - 1] &&
                        fillsRemaining,
                      event.clientY,
                    )
                  }
                />
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={`explorer-view${suppressAccordionActionHover ? " explorer-view--suppress-action-hover" : ""}`}
    >
      <ViewPaneTitle
        title="Explorer"
        actions={
          <div className="explorer-view__views-menu-host">
            <button
              ref={viewsMenuButtonRef}
              type="button"
              className={`view-pane-title__action${viewsMenuOpen ? " view-pane-title__action--open" : ""}`}
              title="Views and More Actions..."
              aria-label="Views and More Actions..."
              aria-expanded={viewsMenuOpen}
              aria-haspopup="menu"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setViewsMenuOpen((open) => !open)}
            >
              <Codicon name="ellipsis" />
            </button>
            {viewsMenuOpen ? (
              <ViewsVisibilityMenu
                items={viewsMenuItems}
                anchorRef={viewsMenuButtonRef}
                onToggle={toggleSectionVisibility}
                onClose={() => setViewsMenuOpen(false)}
              />
            ) : null}
          </div>
        }
      />

      <div className="explorer-view__body">
        {segments.map((segment, index) => renderSegment(segment, index))}
      </div>
    </div>
  );
}

export default ExplorerView;
