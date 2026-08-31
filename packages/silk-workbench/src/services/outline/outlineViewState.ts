export type OutlineSortOrder = "position" | "name" | "category";

export type OutlineViewSnapshot = {
  followCursor: boolean;
  filterOnType: boolean;
  sortBy: OutlineSortOrder;
  collapsedCategories: ReadonlySet<string>;
};

type Listener = () => void;

/**
 * Shared toolbar state for the Outline sidebar section. Split from the actual outline data
 * (which lives at the app level — see apps/silk-db-studio/src/components/outline/OutlineView.tsx
 * — because it needs SQL-specific parsing this shared package can't depend on) so the toolbar
 * (OutlineSectionActions, packages/silk-workbench) and the list it controls can both reach the
 * same live state.
 */
class OutlineViewStateImpl {
  private snapshot: OutlineViewSnapshot = {
    followCursor: false,
    filterOnType: false,
    sortBy: "position",
    collapsedCategories: new Set(),
  };
  private knownCategories: string[] = [];
  private readonly listeners = new Set<Listener>();

  getSnapshot(): OutlineViewSnapshot {
    return this.snapshot;
  }

  toggleFollowCursor(): void {
    this.snapshot = { ...this.snapshot, followCursor: !this.snapshot.followCursor };
    this.fire();
  }

  toggleFilterOnType(): void {
    this.snapshot = { ...this.snapshot, filterOnType: !this.snapshot.filterOnType };
    this.fire();
  }

  setSortBy(sortBy: OutlineSortOrder): void {
    if (this.snapshot.sortBy === sortBy) return;
    this.snapshot = { ...this.snapshot, sortBy };
    this.fire();
  }

  toggleCategory(category: string): void {
    const next = new Set(this.snapshot.collapsedCategories);
    if (next.has(category)) {
      next.delete(category);
    } else {
      next.add(category);
    }
    this.snapshot = { ...this.snapshot, collapsedCategories: next };
    this.fire();
  }

  /** OutlineView reports the categories currently on screen so collapse-all has a target set. */
  setKnownCategories(categories: readonly string[]): void {
    this.knownCategories = [...categories];
  }

  areAllCollapsed(): boolean {
    return (
      this.knownCategories.length > 0 &&
      this.knownCategories.every((category) =>
        this.snapshot.collapsedCategories.has(category),
      )
    );
  }

  toggleCollapseAll(): void {
    const next = this.areAllCollapsed()
      ? new Set<string>()
      : new Set(this.knownCategories);
    this.snapshot = { ...this.snapshot, collapsedCategories: next };
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

export const OutlineViewState = new OutlineViewStateImpl();
