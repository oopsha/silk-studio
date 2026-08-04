type DirtyCell = {
  originalValue: string | null;
  currentValue: string | null;
};

type TabDirtyStore = {
  columns: string[];
  originalRows: Array<Record<string, string | null>>;
  dirtyByRow: Map<number, Map<string, DirtyCell>>;
};

type DirtyListener = () => void;

class QueryResultDirtyServiceImpl {
  private readonly stores = new Map<string, TabDirtyStore>();
  private readonly listeners = new Set<DirtyListener>();

  initTab(
    tabId: string,
    columns: string[],
    rows: Array<Array<string | null>>,
  ): void {
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
    });
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
    if (!store || store.dirtyByRow.size === 0) {
      return;
    }
    store.dirtyByRow.clear();
    this.emit();
  }

  setCell(
    tabId: string,
    rowIndex: number,
    column: string,
    currentValue: string | null,
  ): void {
    const store = this.stores.get(tabId);
    if (!store) return;

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
