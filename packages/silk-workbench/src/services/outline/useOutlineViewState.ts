import { useSyncExternalStore } from "react";
import { OutlineViewState, type OutlineViewSnapshot } from "./outlineViewState";

export function useOutlineViewState(): OutlineViewSnapshot {
  return useSyncExternalStore(
    (listener) => OutlineViewState.onDidChange(listener),
    () => OutlineViewState.getSnapshot(),
  );
}
