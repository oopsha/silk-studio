import { useEffect, useState } from "react";
import { EditorService } from "./editorServiceFacade";
import { EditorGroupsService } from "./editorGroupsService";
import type { EditorGroupId } from "./editorGroupTypes";
import type { EditorTab } from "./editorTypes";

function activeTabFor(groupId?: EditorGroupId): EditorTab | undefined {
  return groupId
    ? EditorGroupsService.getGroup(groupId).getActiveTab()
    : EditorService.getActiveTab();
}

function snapshotActiveTab(groupId?: EditorGroupId): EditorTab | undefined {
  const tab = activeTabFor(groupId);
  return tab ? { ...tab } : undefined;
}

/**
 * Without a `groupId`, tracks the focused group's active tab (existing
 * single-editor call sites). With a `groupId`, tracks that specific group's
 * own active tab regardless of focus — required for rendering an unfocused
 * split pane, which must still reflect its own state.
 */
export function useActiveEditor(groupId?: EditorGroupId): EditorTab | undefined {
  const [activeTab, setActiveTab] = useState(() => snapshotActiveTab(groupId));

  useEffect(() => {
    setActiveTab(snapshotActiveTab(groupId));
    if (groupId) {
      return EditorGroupsService.getGroup(groupId).onDidChange(() => {
        setActiveTab(snapshotActiveTab(groupId));
      });
    }
    return EditorService.onDidChange(() => {
      setActiveTab(snapshotActiveTab(groupId));
    });
  }, [groupId]);

  return activeTab;
}
