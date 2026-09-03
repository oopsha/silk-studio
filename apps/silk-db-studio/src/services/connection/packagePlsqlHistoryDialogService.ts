import type { PlsqlEditorRef } from "./plsqlEditorConstants";

export type PackagePlsqlHistoryDialogRequest = {
  /** `packageBody` is irrelevant here — history/restore always covers Spec + Body together. */
  ref: PlsqlEditorRef;
  objectLabel: string;
  currentSpecContent: string;
  currentBodyContent: string;
  onRestore: (spec: string, body: string) => void;
};

type Listener = () => void;

/**
 * Package Spec/Body snapshot history — unlike `PlsqlSnapshotDialogService`, this has no `tabId`
 * (see PackagePlsqlSaveDialogService's doc comment for why): restoring a snapshot just invokes
 * `onRestore` so the caller can write into its own local buffer state. A snapshot entry always
 * covers both halves together (mirrors Save/Compare&Save), not one section at a time.
 */
class PackagePlsqlHistoryDialogServiceImpl {
  private request: PackagePlsqlHistoryDialogRequest | null = null;
  private readonly listeners = new Set<Listener>();

  getRequest(): PackagePlsqlHistoryDialogRequest | null {
    return this.request;
  }

  open(request: PackagePlsqlHistoryDialogRequest): void {
    this.request = request;
    this.fireDidChange();
  }

  close(): void {
    if (!this.request) return;
    this.request = null;
    this.fireDidChange();
  }

  onDidChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const PackagePlsqlHistoryDialogService = new PackagePlsqlHistoryDialogServiceImpl();
