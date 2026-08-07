import { useEffect, useState } from "react";
import { EditorService } from "./editorServiceFacade";
import { EditorGroupsService } from "./editorGroupsService";
import type { EditorGroupId } from "./editorGroupTypes";
import type { EditorTab } from "./editorTypes";

function tabsFor(groupId?: EditorGroupId): readonly EditorTab[] {
  return groupId
    ? EditorGroupsService.getGroup(groupId).getTabs()
    : EditorService.getTabs();
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
      return EditorGroupsService.getGroup(groupId).onDidChange(() => {
        setTabs(snapshotTabs(groupId));
      });
    }
    return EditorService.onDidChange(() => {
      setTabs(snapshotTabs(groupId));
    });
  }, [groupId]);

  return tabs;
}
