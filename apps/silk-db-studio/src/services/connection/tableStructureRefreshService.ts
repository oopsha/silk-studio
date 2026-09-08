import type { ObjectEditorRef } from "./objectEditorConstants";

type TableStructureRefreshListener = (ref: ObjectEditorRef) => void;

/**
 * Lets a delayed transaction outcome (especially rollback) ask an open table-properties
 * editor to reload its metadata. The editor owns the actual fetch, so this service stays
 * synchronous and does not retain any tab/UI state.
 */
class TableStructureRefreshServiceImpl {
  private readonly listeners = new Set<TableStructureRefreshListener>();

  request(ref: ObjectEditorRef): void {
    for (const listener of this.listeners) {
      listener(ref);
    }
  }

  onDidRequest(listener: TableStructureRefreshListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const TableStructureRefreshService = new TableStructureRefreshServiceImpl();
