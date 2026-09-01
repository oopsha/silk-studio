type DirtyCell = {
  originalValue: string | null;
  currentValue: string | null;
};

type TabDirtyStore = {
  columns: string[];
  originalRows: Array<Record<string, string | null>>;
  dirtyByRow: Map<number, Map<string, DirtyCell>>;
  deletedRows: Set<number>;
  /** Not-yet-saved rows added via "Add row"/"Duplicate row" — keyed by their synthetic negative
   *  `rowIndex` (see `nextNewRowIndex`), which never collides with a real 0+ query-result index. */
  newRows: Set<number>;
  nextNewRowIndex: number;
};

type DirtyListener = () => void;

class QueryResultDirtyServiceImpl {
  private readonly stores = new Map<string, TabDirtyStore>();
  private readonly listeners = new Set<DirtyListener>();

  /**
   * No-ops if `tabId` already has a store. `QueryResultGrid` calls this on every mount — including
   * a remount of the *same* result tab (e.g. switching to another editor tab and back) — so this
   * must not clobber pending edits from before the remount. A genuinely new result set always
   * reaches here with a fresh `tabId`: `queryExecutionService`'s `beginRun` explicitly calls
   * `removeTabs` on the previous result tabs before creating new ones, so no stale store can be
   * sitting under a "new" id.
   */
  initTab(
    tabId: string,
    columns: string[],
    rows: Array<Array<string | null>>,
  ): void {
    if (this.stores.has(tabId)) return;
    const originalRows = rows.map((cells) => {
      const row: Record<string, string | null> = {};
      columns.forEach((column, index) => {
        row[column] = cells[index] ?? null;
      });
      return row;
    });

    this.stores.set(tabId, {
      columns,
      originalRows,
      dirtyByRow: new Map(),
      deletedRows: new Set(),
      newRows: new Set(),
      nextNewRowIndex: 0,
    });
    this.emit();
  }

  /**
   * Registers the "original" (pre-edit) values for one page of rows fetched after `initTab` —
   * Infinite Row Model scrolling (`QueryResultGrid`'s `useInfiniteMode`) loads rows in blocks well
   * beyond the tab's initial batch, and `setCell`'s dirty-tracking needs an original snapshot for
   * *every* row a user might edit, not just the first page. `startIndex` must match the row's own
   * stamped `__rowIndex` (see `toQueryResultRows`'s `startIndex` param) so indices line up.
   */
  appendOriginalRows(
    tabId: string,
    startIndex: number,
    columns: string[],
    rows: Array<Array<string | null>>,
  ): void {
    const store = this.stores.get(tabId);
    if (!store) return;
    rows.forEach((cells, offset) => {
      const row: Record<string, string | null> = {};
      columns.forEach((column, index) => {
        row[column] = cells[index] ?? null;
      });
      store.originalRows[startIndex + offset] = row;
    });
  }

  /** True when `tabId` has any unsaved cell edits, delete marks, or added/duplicated rows. */
  hasPendingChanges(tabId: string): boolean {
    const store = this.stores.get(tabId);
    if (!store) return false;
    return (
      store.dirtyByRow.size > 0 ||
      store.deletedRows.size > 0 ||
      store.newRows.size > 0
    );
  }

  /**
   * Reconstructs the "as currently shown" values for `rowIndex` — its original snapshot with any
   * pending cell edits overlaid. Shared by `duplicateRow` (source row's live values) and the
   * INSERT-statement builder (a new/duplicated row's full column set, since untouched columns
   * never get a `dirtyByRow` entry and must still be read from their `originalRows` seed).
   */
  getEffectiveRow(tabId: string, rowIndex: number): Record<string, string | null> | null {
    const store = this.stores.get(tabId);
    const original = store?.originalRows[rowIndex];
    if (!store || !original) return null;
    const overlay = store.dirtyByRow.get(rowIndex);
    if (!overlay) return { ...original };
    const effective = { ...original };
    for (const [column, cell] of overlay) {
      effective[column] = cell.currentValue;
    }
    return effective;
  }

  /** Adds a blank new row (all columns `null`) and returns its synthetic (negative) rowIndex. */
  addNewRow(tabId: string, columns: string[]): number | null {
    const store = this.stores.get(tabId);
    if (!store) return null;
    const rowIndex = (store.nextNewRowIndex -= 1);
    const blank: Record<string, string | null> = {};
    columns.forEach((column) => {
      blank[column] = null;
    });
    store.originalRows[rowIndex] = blank;
    store.newRows.add(rowIndex);
    this.emit();
    return rowIndex;
  }

  /**
   * Adds a new row seeded from `sourceRowIndex`'s current (edit-overlaid) values, including its
   * primary key — PK columns are editable on new/duplicated rows (see `QueryResultGrid`'s
   * `editable` callback), so the user can change them before saving; if left as-is, the INSERT
   * will simply fail on the database's own PK/unique constraint, which is the authoritative
   * duplicate check anyway (no point re-implementing it client-side).
   */
  duplicateRow(tabId: string, sourceRowIndex: number): number | null {
    const store = this.stores.get(tabId);
    if (!store) return null;
    const sourceValues = this.getEffectiveRow(tabId, sourceRowIndex);
    if (!sourceValues) return null;
    const rowIndex = (store.nextNewRowIndex -= 1);
    store.originalRows[rowIndex] = { ...sourceValues };
    store.newRows.add(rowIndex);
    this.emit();
    return rowIndex;
  }

  isNewRow(tabId: string, rowIndex: number): boolean {
    return this.stores.get(tabId)?.newRows.has(rowIndex) ?? false;
  }

  getNewRowCount(tabId: string): number {
    return this.stores.get(tabId)?.newRows.size ?? 0;
  }

  getNewRowIndexes(tabId: string): number[] {
    const store = this.stores.get(tabId);
    if (!store) return [];
    // Descending — rows are added most-recent-first (each new index is lower than the last).
    return [...store.newRows].sort((a, b) => b - a);
  }

  /** Discards a not-yet-saved added/duplicated row entirely (as opposed to marking it deleted —
   *  it was never saved, so there's nothing in the database to target with a DELETE). */
  discardNewRow(tabId: string, rowIndex: number): void {
    const store = this.stores.get(tabId);
    if (!store || !store.newRows.has(rowIndex)) return;
    store.newRows.delete(rowIndex);
    delete store.originalRows[rowIndex];
    store.dirtyByRow.delete(rowIndex);
    this.emit();
  }

  removeTab(tabId: string): void {
    if (this.stores.delete(tabId)) {
      this.emit();
    }
  }

  removeTabs(tabIds: Iterable<string>): void {
    let changed = false;
    for (const tabId of tabIds) {
      if (this.stores.delete(tabId)) {
        changed = true;
      }
    }
    if (changed) {
      this.emit();
    }
  }

  clearTab(tabId: string): void {
    const store = this.stores.get(tabId);
    if (
      !store ||
      (store.dirtyByRow.size === 0 &&
        store.deletedRows.size === 0 &&
        store.newRows.size === 0)
    ) {
      return;
    }
    store.dirtyByRow.clear();
    store.deletedRows.clear();
    for (const rowIndex of store.newRows) {
      delete store.originalRows[rowIndex];
    }
    store.newRows.clear();
    this.emit();
  }

  /**
   * Toggles whether `rowIndex` is marked for deletion. Marking a row deleted also drops any
   * pending cell edits on it — the row won't exist after Save, so per-cell changes are moot and
   * would otherwise still show up (confusingly) in the dirty-cell count/preview.
   */
  toggleRowDeleted(tabId: string, rowIndex: number): void {
    const store = this.stores.get(tabId);
    if (!store) return;

    if (store.deletedRows.has(rowIndex)) {
      store.deletedRows.delete(rowIndex);
    } else {
      store.deletedRows.add(rowIndex);
      store.dirtyByRow.delete(rowIndex);
    }
    this.emit();
  }

  isRowDeleted(tabId: string, rowIndex: number): boolean {
    return this.stores.get(tabId)?.deletedRows.has(rowIndex) ?? false;
  }

  getDeletedRowCount(tabId: string): number {
    return this.stores.get(tabId)?.deletedRows.size ?? 0;
  }

  getDeletedRowIndexes(tabId: string): number[] {
    const store = this.stores.get(tabId);
    if (!store) return [];
    return [...store.deletedRows].sort((a, b) => a - b);
  }

  setCell(
    tabId: string,
    rowIndex: number,
    column: string,
    currentValue: string | null,
  ): void {
    const store = this.stores.get(tabId);
    // A row marked for deletion is not editable in the grid (see QueryResultGrid's `editable`
    // callback), but guard here too in case a caller bypasses that.
    if (!store || store.deletedRows.has(rowIndex)) return;

    const originalValue = store.originalRows[rowIndex]?.[column] ?? null;
    const normalizedCurrent = currentValue === undefined ? null : currentValue;

    let rowDirty = store.dirtyByRow.get(rowIndex);
    if (!rowDirty) {
      rowDirty = new Map();
      store.dirtyByRow.set(rowIndex, rowDirty);
    }

    if (originalValue === normalizedCurrent) {
      rowDirty.delete(column);
      if (rowDirty.size === 0) {
        store.dirtyByRow.delete(rowIndex);
      }
    } else {
      rowDirty.set(column, { originalValue, currentValue: normalizedCurrent });
    }

    this.emit();
  }

  getDirtyCount(tabId: string): number {
    const store = this.stores.get(tabId);
    if (!store) return 0;
    let count = 0;
    for (const row of store.dirtyByRow.values()) {
      count += row.size;
    }
    return count;
  }

  getDirtyRowCount(tabId: string): number {
    return this.stores.get(tabId)?.dirtyByRow.size ?? 0;
  }

  getDirtyRows(tabId: string): Array<{
    rowIndex: number;
    changes: Array<{
      column: string;
      originalValue: string | null;
      currentValue: string | null;
    }>;
  }> {
    const store = this.stores.get(tabId);
    if (!store) return [];

    return [...store.dirtyByRow.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rowIndex, cells]) => ({
        rowIndex,
        changes: [...cells.entries()].map(([column, change]) => ({
          column,
          originalValue: change.originalValue,
          currentValue: change.currentValue,
        })),
      }));
  }

  getOriginalRows(tabId: string): Array<Record<string, string | null>> {
    return this.stores.get(tabId)?.originalRows ?? [];
  }

  onDidChange(listener: DirtyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const QueryResultDirtyService = new QueryResultDirtyServiceImpl();
