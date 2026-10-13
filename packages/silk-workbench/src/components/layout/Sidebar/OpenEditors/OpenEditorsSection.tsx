import { useMemo, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import type { EditorGroupId } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import { collectGroupIds } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import { codiconForLanguage } from "@silk-studio/editor/services/editor/languageFromPath.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { useEditorGroupsLayout } from "@silk-studio/editor/services/editor/useEditorGroupsLayout.ts";
import { useEditorTabs } from "@silk-studio/editor/services/editor/useEditorTabs.ts";
import TabBarContextMenu from "@silk-studio/editor/components/layout/TabBar/TabBarContextMenu.tsx";
import type {
  TabBarCommandAdapter,
  TabBarLabels,
} from "@silk-studio/editor/components/layout/TabBar/TabBar.tsx";
import { CommandService } from "../../../../platform/commands/commandService.ts";
import { KeybindingsRegistry } from "../../../../platform/keybinding/keybindingRegistry.ts";
import type { MessageKey } from "../../../../platform/i18n/translate.ts";
import { useI18n } from "../../../../platform/i18n/useI18n.ts";
import AccordionPanel from "../AccordionPanel/AccordionPanel.tsx";
import "./OpenEditorsSection.css";

type OpenEditorsSectionProps = {
  newFileTitleKey: MessageKey;
  expanded: boolean;
  onToggle: () => void;
};

const ACTIONS: { icon: string; command: string; labelKey?: MessageKey }[] = [
  { icon: "new-file", command: "silk.file.newTextFile" },
  {
    icon: "save-all",
    command: "silk.file.saveAll",
    labelKey: "workbench.sidebar.saveAll",
  },
  {
    icon: "close-all",
    command: "silk.file.closeAll",
    labelKey: "workbench.sidebar.closeAll",
  },
];

function OpenEditorsGroup({
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
  const [contextMenu, setContextMenu] = useState<
    { tabId: string; top: number; left: number } | null
  >(null);

  const labels: TabBarLabels = {
    showOpenedEditors: t("workbench.commands.showAllEditors"),
    closeAll: t("workbench.commands.closeAllEditors"),
    closeSaved: t("workbench.commands.closeAllSavedEditors"),
    enablePreviewEditors: t("workbench.commands.togglePreviewEditors"),
    lockGroup: t("workbench.commands.lockEditorGroup"),
    configureEditors: t("workbench.commands.configureEditors"),
    close: t("workbench.commands.closeActiveEditor"),
    closeOthers: t("workbench.commands.closeOtherEditors"),
    closeToTheRight: t("workbench.commands.closeEditorsToTheRight"),
    keepOpen: t("workbench.commands.pinEditor"),
    splitEditorRight: t("workbench.commands.splitEditorRight"),
    closeEditorGroup: t("workbench.commands.closeEditorGroup"),
    moreActions: t("workbench.tabBar.moreActions"),
    closeTabAriaLabel: (label) =>
      t("workbench.tabBar.closeTabAriaLabel").replace("{name}", label),
  };
  const commands: TabBarCommandAdapter = {
    executeCommand: (commandId) => CommandService.executeCommand(commandId),
    lookupKeybinding: (commandId) => KeybindingsRegistry.lookupKeybinding(commandId),
  };

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
            title={tab.tooltip ?? tab.uri ?? tab.label}
            onClick={() => {
              EditorGroupsService.setFocusedGroup(groupId);
              EditorGroupsService.getGroup(groupId).setActiveTab(tab.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              EditorGroupsService.setFocusedGroup(groupId);
              EditorGroupsService.getGroup(groupId).setActiveTab(tab.id);
              setContextMenu({
                tabId: tab.id,
                top: event.clientY,
                left: event.clientX,
              });
            }}
          >
            <span className="open-editors-list__icon" aria-hidden>
              <Codicon name={codiconForLanguage(tab.languageId)} />
            </span>
            <span className="open-editors-list__label">{tab.label}</span>
            {tab.description ? (
              <span className="open-editors-list__description">
                {tab.description}
              </span>
            ) : null}
            <span className="open-editors-list__actions">
              {tab.isDirty ? (
                <span className="open-editors-list__dirty" aria-hidden />
              ) : null}
              <button
                type="button"
                className="open-editors-list__close"
                aria-label={labels.closeTabAriaLabel(tab.label)}
                onClick={(event) => {
                  event.stopPropagation();
                  EditorGroupsService.closeTab(groupId, tab.id);
                }}
              >
                <Codicon name="close" />
              </button>
            </span>
          </li>
        );
      })}
      {contextMenu ? (
        <TabBarContextMenu
          tabId={contextMenu.tabId}
          anchor={{ top: contextMenu.top, left: contextMenu.left }}
          commands={commands}
          labels={labels}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
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
        <OpenEditorsGroup
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

function OpenEditorsSection({
  newFileTitleKey,
  expanded,
  onToggle,
}: OpenEditorsSectionProps) {
  const { t } = useI18n();

  return (
    <AccordionPanel
      title={t("workbench.sidebar.openEditors")}
      expanded={expanded}
      variant="fixed"
      onToggle={onToggle}
      actions={
        <>
          {ACTIONS.map((action) => {
            const label = action.labelKey ? t(action.labelKey) : t(newFileTitleKey);
            return (
              <button
                key={action.command}
                type="button"
                className="accordion-panel__action"
                title={label}
                aria-label={label}
                onClick={() => void CommandService.executeCommand(action.command)}
              >
                <Codicon name={action.icon} />
              </button>
            );
          })}
        </>
      }
    >
      {expanded ? <OpenEditorsList /> : null}
    </AccordionPanel>
  );
}

export default OpenEditorsSection;
