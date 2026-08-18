import type { editor } from "monaco-editor";

/**
 * Tracks Monaco editor instances that live outside `EditorGroupsService`'s own
 * per-group `activeTextEditor` tracking — i.e. anything mounted via `renderAlternative`
 * (the standalone "View DDL" tab and the object editor's embedded Properties→DDL
 * section, both via `DdlPreview.tsx`) rather than `EditorArea`'s own `<Editor>`.
 *
 * Deliberately does NOT use Monaco's own `editor.getEditors()` global registry — in a
 * pnpm workspace, `packages/silk-editor` and this app each declare their own
 * `monaco-editor` dependency, and `@monaco-editor/react`'s loader can end up resolving
 * to a different module instance per package, so a statically-imported `editor`
 * namespace here may not see instances created through a different copy at all. Storing
 * the exact object each view's own `onMount` hands us sidesteps that entirely — no
 * `instanceof`/module-identity assumptions, just duck-typed method calls.
 */
const instances = new Set<editor.ICodeEditor>();

export function registerMonacoInstance(instance: editor.ICodeEditor): () => void {
  instances.add(instance);
  return () => {
    instances.delete(instance);
  };
}

export function findRegisteredMonacoInstanceAt(element: Element): editor.ICodeEditor | null {
  for (const instance of instances) {
    const node = instance.getDomNode();
    if (node?.contains(element)) return instance;
  }
  return null;
}
