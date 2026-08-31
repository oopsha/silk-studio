import { useSyncExternalStore } from "react";
import { TimelineViewState, type TimelineViewSnapshot } from "./timelineViewState";

export function useTimelineViewState(): TimelineViewSnapshot {
  return useSyncExternalStore(
    (listener) => TimelineViewState.onDidChange(listener),
    () => TimelineViewState.getSnapshot(),
  );
}
