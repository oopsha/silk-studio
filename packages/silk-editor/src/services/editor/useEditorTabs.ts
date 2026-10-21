import { useEffect, useState } from "react";
import { EditorService } from "./editorServiceFacade";
import { EditorGroupsService } from "./editorGroupsService";
import type { EditorGroupId } from "./editorGroupTypes";
import type { EditorTab } from "./editorTypes";

function tabsFor(groupId?: EditorGroupId): readonly EditorTab[] {
  if (!groupId) return EditorService.getTabs();
  return EditorGroupsService.getGroupIfExists(groupId)?.getTabs() ?? [];
}

function snapshotTabs(groupId?: EditorGroupId): EditorTab[] {
  return tabsFor(groupId).map((tab) => ({ ...tab }));
}

/** See {@link useActiveEditor} for the `groupId`-present-vs-absent contract. */
export function useEditorTabs(groupId?: EditorGroupId): readonly EditorTab[] {
  const [tabs, setTabs] = useState(() => snapshotTabs(groupId));

  useEffect(() => {
    setTabs(snapshotTabs(groupId));
    if (groupId) {
      const group = EditorGroupsService.getGroupIfExists(groupId);
      if (!group) return;
      return group.onDidChange(() => {
        setTabs(snapshotTabs(groupId));
      });
    }
    return EditorService.onDidChange(() => {
      setTabs(snapshotTabs(groupId));
    });
  }, [groupId]);

  return tabs;
}
