import { QueryResultDataService } from "./queryResultDataService";
import { QUERY_RESULT_ROW_INDEX_KEY, type QueryResultRow } from "./queryResult";

type DirtyCell = {
  originalValue: string | null;
  currentValue: string | null;
};

type TabDirtyStore = {
  columns: string[];
  newRowValues: Map<number, Record<string, string | null>>;
  dirtyByRow: Map<number, Map<string, DirtyCell>>;
  deletedRows: Set<number>;
  /** Not-yet-saved rows added via "Add row"/"Duplicate row" — keyed by their synthetic negative
   *  `rowIndex` (see `nextNewRowIndex`), which never collides with a real 0+ query-result index.
   *  Value is the rowIndex (existing or another new row's) this row was inserted directly after,
   *  or `null` for "inserted at the top" — used to restore each row's grid position after a
   *  remount (see the derived grid snapshot), since insertion order alone
   *  doesn't capture *where* a row was added. */
  newRows: Map<number, number | null>;
  truncateBeforeImport: boolean;
  nextNewRowIndex: number;
};

type DirtyListener = () => void;

class QueryResultDirtyServiceImpl {
  private readonly stores = new Map<string, TabDirtyStore>();
  private readonly listeners = new Set<DirtyListener>();
  private readonly displayedRows = new Map<string, QueryResultRow[]>();
  private readonly rowSnapshots = new Map<string, Map<number, QueryResultRow>>();
  private readonly revisions = new Map<string, number>();

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
    QueryResultDataService.replace(tabId, columns, rows);

    this.stores.set(tabId, {
      columns,
      newRowValues: new Map(),
      dirtyByRow: new Map(),
      deletedRows: new Set(),
      newRows: new Map(),
      truncateBeforeImport: false,
      nextNewRowIndex: 0,
    });
    this.emit(tabId);
  }

  /**
   * Registers the "original" (pre-edit) values for one page of rows fetched after `initTab` —
   * Incremental result scrolling loads rows in blocks well beyond the tab's initial batch, and
   * `setCell`'s dirty-tracking needs an original snapshot for every row a user might edit, not
   * just the first page. `startIndex` must match the row's own stamped `__rowIndex` (see
   * `toQueryResultRows`'s `startIndex` param) so indices line up.
   */
  appendOriginalRows(
    tabId: string,
    startIndex: number,
    columns: string[],
    rows: Array<Array<string | null>>,
  ): void {
    const store = this.stores.get(tabId);
    if (!store) return;
    QueryResultDataService.append(tabId, startIndex, columns, rows);
    this.emit(tabId);
  }

  /** Atomically replaces the authoritative baseline and discards edits for the old row positions. */
  replaceOriginalRows(tabId: string, columns: string[], rows: Array<Array<string | null>>): void {
    if (!this.stores.has(tabId)) {
      this.initTab(tabId, columns, rows);
      return;
    }
    const store = this.stores.get(tabId)!;
    store.columns = columns;
    store.dirtyByRow.clear();
    store.deletedRows.clear();
    store.newRows.clear();
    store.newRowValues.clear();
    store.truncateBeforeImport = false;
    QueryResultDataService.replace(tabId, columns, rows);
    this.emit(tabId);
  }

  /** True when `tabId` has any unsaved cell edits, delete marks, or added/duplicated rows. */
  hasPendingChanges(tabId: string): boolean {
    const store = this.stores.get(tabId);
    if (!store) return false;
    return (
      store.dirtyByRow.size > 0 ||
      store.deletedRows.size > 0 ||
      store.newRows.size > 0 ||
      store.truncateBeforeImport
    );
  }

  setTruncateBeforeImport(tabId: string, value: boolean): void {
    const store = this.stores.get(tabId);
    if (!store || store.truncateBeforeImport === value) return;
    store.truncateBeforeImport = value;
    this.emit(tabId);
  }

  getTruncateBeforeImport(tabId: string): boolean {
    return this.stores.get(tabId)?.truncateBeforeImport ?? false;
  }

  /**
   * Reconstructs the "as currently shown" values for `rowIndex` — its original snapshot with any
   * pending cell edits overlaid. Shared by `duplicateRow` (source row's live values) and the
   * INSERT-statement builder (a new/duplicated row's full column set, since untouched columns
   * never get a `dirtyByRow` entry and must still be read from their pending INSERT values).
   */
  getEffectiveRow(tabId: string, rowIndex: number): Record<string, string | null> | null {
    const store = this.stores.get(tabId);
    const original = store?.newRowValues.get(rowIndex) ?? QueryResultDataService.getRow(tabId, rowIndex);
    if (!store || !original) return null;
    const overlay = store.dirtyByRow.get(rowIndex);
    if (!overlay) return { ...original };
    const effective = { ...original };
    for (const [column, cell] of overlay) {
      effective[column] = cell.currentValue;
    }
    return effective;
  }

  /**
   * Adds a blank new row (all columns `null`) and returns its synthetic (negative) rowIndex.
   * `insertAfter` is the rowIndex (existing or another new row's) it was inserted directly after,
   * or `null` for "inserted at the top" — see `newRows`' doc.
   */
  addNewRow(tabId: string, columns: string[], insertAfter: number | null): number | null {
    const store = this.stores.get(tabId);
    if (!store) return null;
    const rowIndex = (store.nextNewRowIndex -= 1);
    const blank: Record<string, string | null> = {};
    columns.forEach((column) => {
      blank[column] = null;
    });
    store.newRowValues.set(rowIndex, blank);
    store.newRows.set(rowIndex, insertAfter);
    this.emit(tabId);
    return rowIndex;
  }

  /** Adds imported values as pending INSERT rows, preserving source row order. */
  addImportedRows(
    tabId: string,
    columns: string[],
    rows: Array<Record<string, string | null>>,
    insertAfter: number | null,
  ): number[] {
    const store = this.stores.get(tabId);
    if (!store || rows.length === 0) return [];
    let anchor = insertAfter;
    const indexes: number[] = [];
    for (const values of rows) {
      const rowIndex = (store.nextNewRowIndex -= 1);
      const row: Record<string, string | null> = {};
      columns.forEach((column) => {
        row[column] = values[column] ?? null;
      });
      store.newRowValues.set(rowIndex, row);
      store.newRows.set(rowIndex, anchor);
      indexes.push(rowIndex);
      anchor = rowIndex;
    }
    this.emit(tabId);
    return indexes;
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
    store.newRowValues.set(rowIndex, { ...sourceValues });
    store.newRows.set(rowIndex, sourceRowIndex);
    this.emit(tabId);
    return rowIndex;
  }

  isNewRow(tabId: string, rowIndex: number): boolean {
    return this.stores.get(tabId)?.newRows.has(rowIndex) ?? false;
  }

  /** The rowIndex `rowIndex` (a new/duplicated row) was inserted directly after, or `null` for
   *  "inserted at the top" — see `newRows`' doc. Returns `undefined` if `rowIndex` isn't a
   *  tracked new row. */
  getNewRowAnchor(tabId: string, rowIndex: number): number | null | undefined {
    return this.stores.get(tabId)?.newRows.get(rowIndex);
  }

  /** True when `rowIndex` has at least one unsaved cell edit (excludes added/duplicated rows —
   *  those are flagged via `isNewRow` instead, which takes visual precedence in the grid). */
  isRowDirty(tabId: string, rowIndex: number): boolean {
    const store = this.stores.get(tabId);
    if (!store || store.newRows.has(rowIndex)) return false;
    return store.dirtyByRow.has(rowIndex);
  }

  getNewRowCount(tabId: string): number {
    return this.stores.get(tabId)?.newRows.size ?? 0;
  }

  /**
   * Creation order (oldest first) — `newRows` is a `Map`, which iterates in insertion order.
   * The derived view relies on this order: a row's `insertAfter` anchor
   * may itself be another new row, so replaying oldest-first guarantees that anchor already has a
   * grid row by the time its dependent is re-added.
   */
  getNewRowIndexes(tabId: string): number[] {
    const store = this.stores.get(tabId);
    if (!store) return [];
    return [...store.newRows.keys()];
  }

  /** Discards a not-yet-saved added/duplicated row entirely (as opposed to marking it deleted —
   *  it was never saved, so there's nothing in the database to target with a DELETE). */
  discardNewRow(tabId: string, rowIndex: number): void {
    const store = this.stores.get(tabId);
    if (!store || !store.newRows.has(rowIndex)) return;
    store.newRows.delete(rowIndex);
    store.newRowValues.delete(rowIndex);
    store.dirtyByRow.delete(rowIndex);
    this.emit(tabId);
  }

  removeTab(tabId: string): void {
    QueryResultDataService.remove(tabId);
    this.rowSnapshots.delete(tabId);
    this.revisions.delete(tabId);
    if (this.stores.delete(tabId)) {
      this.emit(tabId);
    }
  }

  removeTabs(tabIds: Iterable<string>): void {
    let changed = false;
    for (const tabId of tabIds) {
      QueryResultDataService.remove(tabId);
      this.displayedRows.delete(tabId);
      this.rowSnapshots.delete(tabId);
      this.revisions.delete(tabId);
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
        store.newRows.size === 0 &&
        !store.truncateBeforeImport)
    ) {
      return;
    }
    store.dirtyByRow.clear();
    store.deletedRows.clear();
    for (const rowIndex of store.newRows.keys()) {
      store.newRowValues.delete(rowIndex);
    }
    store.newRows.clear();
    store.truncateBeforeImport = false;
    this.emit(tabId);
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
    this.emit(tabId);
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

    const originalValue = (store.newRowValues.get(rowIndex) ?? QueryResultDataService.getRow(tabId, rowIndex))?.[column] ?? null;
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

    this.emit(tabId);
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
    return QueryResultDataService.getRows(tabId);
  }

  getDisplayRows(tabId: string): QueryResultRow[] {
    const cached = this.displayedRows.get(tabId);
    if (cached) return cached;
    const store = this.stores.get(tabId);
    const ordered = store?.truncateBeforeImport ? [] : QueryResultDataService.getRows(tabId).map((_, index) => index);
    if (store) {
      // Insertion order keeps newly inserted rows immediately after their recorded anchor.
      for (const [index, anchor] of store.newRows) {
        const position = anchor == null ? -1 : ordered.indexOf(anchor);
        ordered.splice(position + 1, 0, index);
      }
    }
    const previous = this.rowSnapshots.get(tabId);
    const snapshots = new Map<number, QueryResultRow>();
    const rows = ordered.map((index) => {
      const next: QueryResultRow = { ...this.getEffectiveRow(tabId, index), [QUERY_RESULT_ROW_INDEX_KEY]: String(index) };
      const old = previous?.get(index);
      // Preserve untouched row identities so an edit does not redraw the entire loaded result.
      const row = old && Object.keys(old).length === Object.keys(next).length &&
        Object.keys(next).every((key) => old[key] === next[key]) ? old : next;
      snapshots.set(index, row);
      return row;
    });
    this.rowSnapshots.set(tabId, snapshots);
    this.displayedRows.set(tabId, rows);
    return rows;
  }

  hasTab(tabId: string): boolean {
    return this.stores.has(tabId);
  }

  getRevision(tabId: string): number { return this.revisions.get(tabId) ?? 0; }

  onDidChange(listener: DirtyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(tabId?: string): void {
    if (tabId && this.stores.has(tabId)) this.revisions.set(tabId, (this.revisions.get(tabId) ?? 0) + 1);
    if (tabId) this.displayedRows.delete(tabId);
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const QueryResultDirtyService = new QueryResultDirtyServiceImpl();
