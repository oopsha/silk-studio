import { editor, Uri } from "monaco-editor";
import type { EditorTab } from "./editorTypes";

/** Stable Monaco model URI for `@monaco-editor/react` `path` / `keepCurrentModel`. */
export function monacoModelPathForTab(
  tab: Pick<EditorTab, "id" | "uri">,
): string {
  return tab.uri ?? `silk-tab://${tab.id}`;
}

export function disposeMonacoModelForTab(
  tab: Pick<EditorTab, "id" | "uri">,
): void {
  try {
    editor.getModel(Uri.parse(monacoModelPathForTab(tab)))?.dispose();
  } catch {
    // Monaco may not be loaded yet, or the URI may be invalid.
  }
}

/**
 * Restore after `@monaco-editor/react` applies controlled `value` (which can
 * reset scroll if restore runs only in `onMount`).
 */
export function scheduleRestoreViewState(
  instance: editor.IStandaloneCodeEditor,
  getState: () => editor.ICodeEditorViewState | null,
): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const state = getState();
      if (!state) return;
      const model = instance.getModel();
      if (!model || model.isDisposed()) return;
      instance.restoreViewState(state);
    });
  });
}
