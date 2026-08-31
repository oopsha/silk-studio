export type TimelineViewSnapshot = {
  pinned: boolean;
  manualOnly: boolean;
  refreshToken: number;
};

type Listener = () => void;

/**
 * Shared toolbar state for the Timeline sidebar section. Split from the actual timeline data
 * (PL/SQL snapshot history — see apps/silk-db-studio/src/components/timeline/TimelineView.tsx,
 * which needs app-level services this shared package can't depend on) so the toolbar
 * (TimelineSectionActions, packages/silk-workbench) and the list it controls share live state.
 */
class TimelineViewStateImpl {
  private snapshot: TimelineViewSnapshot = {
    pinned: false,
    manualOnly: false,
    refreshToken: 0,
  };
  private readonly listeners = new Set<Listener>();

  getSnapshot(): TimelineViewSnapshot {
    return this.snapshot;
  }

  togglePinned(): void {
    this.snapshot = { ...this.snapshot, pinned: !this.snapshot.pinned };
    this.fire();
  }

  toggleManualOnly(): void {
    this.snapshot = { ...this.snapshot, manualOnly: !this.snapshot.manualOnly };
    this.fire();
  }

  refresh(): void {
    this.snapshot = { ...this.snapshot, refreshToken: this.snapshot.refreshToken + 1 };
    this.fire();
  }

  onDidChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fire(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const TimelineViewState = new TimelineViewStateImpl();
