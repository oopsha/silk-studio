import type { EditorGroupContentSnapshot } from "./editorService";
import type { EditorGroupId, EditorLayoutNode } from "./editorGroupTypes";

export type EditorGroupSessionSnapshot = EditorGroupContentSnapshot & {
  groupId: EditorGroupId;
};

export type EditorSessionSnapshotV2 = {
  version: 2;
  savedAt: number;
  layout: EditorLayoutNode;
  focusedGroupId: EditorGroupId;
  groups: EditorGroupSessionSnapshot[];
};
