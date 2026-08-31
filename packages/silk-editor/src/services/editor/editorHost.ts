import type { EditorTab } from "./editorTypes";

export type EditorHostAdapter = {
  setContextKey: (key: string, value: boolean) => void;
  updateWindowTitle: (activeEditor: EditorTab | undefined) => void;
  /** Ask the host to confirm closing a dirty tab with no Hot Exit safety net. */
  confirmCloseDirtyTab: (tab: EditorTab) => Promise<boolean>;
};

let adapter: EditorHostAdapter = {
  setContextKey: () => undefined,
  updateWindowTitle: () => undefined,
  confirmCloseDirtyTab: () => Promise.resolve(true),
};

export function configureEditorHost(nextAdapter: EditorHostAdapter): void {
  adapter = nextAdapter;
}

export const EditorHost = {
  setContextKey(key: string, value: boolean): void {
    adapter.setContextKey(key, value);
  },
  updateWindowTitle(activeEditor: EditorTab | undefined): void {
    adapter.updateWindowTitle(activeEditor);
  },
  confirmCloseDirtyTab(tab: EditorTab): Promise<boolean> {
    return adapter.confirmCloseDirtyTab(tab);
  },
};
