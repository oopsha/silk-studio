import { useEffect, useState } from "react";
import { EditorGroupsService } from "./editorGroupsService";
import type { EditorGroupId, EditorLayoutNode } from "./editorGroupTypes";

export type EditorGroupsLayoutState = {
  layout: EditorLayoutNode;
  focusedGroupId: EditorGroupId;
};

function snapshot(): EditorGroupsLayoutState {
  return {
    layout: EditorGroupsService.getLayout(),
    focusedGroupId: EditorGroupsService.getFocusedGroupId(),
  };
}

export function useEditorGroupsLayout(): EditorGroupsLayoutState {
  const [state, setState] = useState(snapshot);

  useEffect(() => {
    return EditorGroupsService.onDidChange(() => {
      setState(snapshot());
    });
  }, []);

  return state;
}
