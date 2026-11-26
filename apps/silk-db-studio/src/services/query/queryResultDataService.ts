/**
 * Authoritative server rows for each result tab. Grid rows are derived copies.
 *
 * Rows are stored at their result-wide index (`offset + position`), so a paged result holding
 * only page N keeps the same row identity — and edit/delete bookkeeping — as the full result.
 */
class QueryResultDataServiceImpl {
  private readonly data = new Map<string, { columns: string[]; rows: Array<Array<string | null>> }>();

  replace(tabId: string, columns: string[], rows: Array<Array<string | null>>, offset = 0): void {
    if (offset === 0) {
      this.data.set(tabId, { columns, rows });
      return;
    }
    const placed: Array<Array<string | null>> = [];
    rows.forEach((row, index) => { placed[offset + index] = row; });
    this.data.set(tabId, { columns, rows: placed });
  }

  append(tabId: string, offset: number, columns: string[], rows: Array<Array<string | null>>): void {
    const data = this.data.get(tabId);
    if (!data) return;
    const indexes = data.columns.map((column) => columns.indexOf(column));
    if (indexes.some((index) => index < 0)) throw new Error("Result page columns no longer match the loaded result.");
    const next = data.rows.slice();
    rows.forEach((row, index) => { next[offset + index] = indexes.map((i) => row[i] ?? null); });
    this.data.set(tabId, { ...data, rows: next });
  }

  getRow(tabId: string, index: number): Record<string, string | null> | null {
    const data = this.data.get(tabId);
    const cells = data?.rows[index];
    if (!data || !cells) return null;
    return Object.fromEntries(data.columns.map((column, i) => [column, cells[i] ?? null]));
  }

  /** Result-wide indexes of the loaded rows, in order (a page may start past 0). */
  getRowIndexes(tabId: string): number[] {
    const indexes: number[] = [];
    // forEach skips the holes before a page's offset.
    this.data.get(tabId)?.rows.forEach((_, index) => indexes.push(index));
    return indexes;
  }

  /** Indexed by result-wide row index; positions before a page's offset are holes. */
  getRows(tabId: string): Array<Record<string, string | null>> {
    return this.data.get(tabId)?.rows.map((_, index) => this.getRow(tabId, index)!) ?? [];
  }

  remove(tabId: string): void { this.data.delete(tabId); }
}

export const QueryResultDataService = new QueryResultDataServiceImpl();
