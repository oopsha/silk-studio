/** Authoritative server rows for each result tab. Grid rows are derived copies. */
class QueryResultDataServiceImpl {
  private readonly data = new Map<string, { columns: string[]; rows: Array<Array<string | null>> }>();

  replace(tabId: string, columns: string[], rows: Array<Array<string | null>>): void {
    this.data.set(tabId, { columns, rows });
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

  getRows(tabId: string): Array<Record<string, string | null>> {
    return this.data.get(tabId)?.rows.map((_, index) => this.getRow(tabId, index)!) ?? [];
  }

  remove(tabId: string): void { this.data.delete(tabId); }
}

export const QueryResultDataService = new QueryResultDataServiceImpl();
