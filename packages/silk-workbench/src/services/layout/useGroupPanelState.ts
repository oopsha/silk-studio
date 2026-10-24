import { useEffect, useState } from "react";
import type { EditorGroupId } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import { GroupPanelStateService, type GroupPanelVisualState } from "./groupPanelStateService";

export function useGroupPanelState(
  groupId: EditorGroupId,
  editorTabId?: string,
): GroupPanelVisualState {
  const [, setRevision] = useState(0);

  useEffect(() => {
    return GroupPanelStateService.onDidChange(() => {
      setRevision((revision) => revision + 1);
    });
  }, []);

  return GroupPanelStateService.getState(groupId, editorTabId);
}
