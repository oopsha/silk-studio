import { useEffect, useState } from "react";
import type { EditorGroupId } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import { GroupPanelStateService, type GroupPanelVisualState } from "./groupPanelStateService";

export function useGroupPanelState(groupId: EditorGroupId): GroupPanelVisualState {
  const [state, setState] = useState(() => GroupPanelStateService.getState(groupId));

  useEffect(() => {
    setState(GroupPanelStateService.getState(groupId));
    return GroupPanelStateService.onDidChange(() => {
      setState(GroupPanelStateService.getState(groupId));
    });
  }, [groupId]);

  return state;
}
