import type { ConnectionDriverId } from "./connectionTypes";
import type { ExplorerObjectRef } from "./explorerObjectActions";

export type ExplorerMutationMode = "drop" | "rename";

export type ExplorerMutationDialogRequest = {
  mode: ExplorerMutationMode;
  ref: ExplorerObjectRef;
  driverId: ConnectionDriverId;
};

type ExplorerMutationDialogListener = () => void;

class ExplorerObjectMutationDialogServiceImpl {
  private request: ExplorerMutationDialogRequest | null = null;
  private readonly listeners = new Set<ExplorerMutationDialogListener>();

  getRequest(): ExplorerMutationDialogRequest | null {
    return this.request;
  }

  isOpen(): boolean {
    return this.request !== null;
  }

  open(next: ExplorerMutationDialogRequest): void {
    this.request = next;
    this.fireDidChange();
  }

  close(): void {
    if (!this.request) return;
    this.request = null;
    this.fireDidChange();
  }

  onDidChange(listener: ExplorerMutationDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ExplorerObjectMutationDialogService =
  new ExplorerObjectMutationDialogServiceImpl();
