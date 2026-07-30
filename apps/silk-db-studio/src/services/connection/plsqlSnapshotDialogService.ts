import type { PlsqlEditorRef } from "./plsqlEditorConstants";
import type { PlsqlSnapshotEntry } from "./plsqlSnapshotStorage";

export type PlsqlSnapshotDialogMode = "history" | "diff" | "confirm";

export type PlsqlSnapshotConfirmKind = "rollback" | "reload";

export type PlsqlSnapshotDialogRequest = {
  mode: PlsqlSnapshotDialogMode;
  tabId: string;
  ref: PlsqlEditorRef;
  objectLabel: string;
  /** Current editor buffer (for diff / comparison). */
  bufferContent: string;
  /** Selected snapshot when mode is diff or confirm(rollback). */
  snapshot?: PlsqlSnapshotEntry;
  confirmKind?: PlsqlSnapshotConfirmKind;
};

type Listener = () => void;

class PlsqlSnapshotDialogServiceImpl {
  private request: PlsqlSnapshotDialogRequest | null = null;
  private readonly listeners = new Set<Listener>();

  getRequest(): PlsqlSnapshotDialogRequest | null {
    return this.request;
  }

  open(next: PlsqlSnapshotDialogRequest): void {
    this.request = next;
    this.fire();
  }

  /** Switch view while keeping the same tab/ref context. */
  setMode(
    mode: PlsqlSnapshotDialogMode,
    patch?: Partial<
      Pick<PlsqlSnapshotDialogRequest, "snapshot" | "confirmKind" | "bufferContent">
    >,
  ): void {
    if (!this.request) return;
    this.request = {
      ...this.request,
      ...patch,
      mode,
    };
    this.fire();
  }

  close(): void {
    if (!this.request) return;
    this.request = null;
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

export const PlsqlSnapshotDialogService = new PlsqlSnapshotDialogServiceImpl();
