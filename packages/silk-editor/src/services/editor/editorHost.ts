import type { EditorTab } from "./editorTypes";

export type EditorHostAdapter = {
  setContextKey: (key: string, value: boolean) => void;
  updateWindowTitle: (activeEditor: EditorTab | undefined) => void;
};

let adapter: EditorHostAdapter = {
  setContextKey: () => undefined,
  updateWindowTitle: () => undefined,
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
};
