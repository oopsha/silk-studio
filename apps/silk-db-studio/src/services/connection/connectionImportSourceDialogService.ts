import type { ConnectionImportSource } from "./externalConnectionImport";

type Listener = () => void;

class ConnectionImportSourceDialogServiceImpl {
  private visible = false;
  private resolvePending: ((source: ConnectionImportSource | null) => void) | null = null;
  private readonly listeners = new Set<Listener>();

  isVisible(): boolean {
    return this.visible;
  }

  open(): Promise<ConnectionImportSource | null> {
    this.resolvePending?.(null);
    this.visible = true;
    this.fireDidChange();
    return new Promise((resolve) => {
      this.resolvePending = resolve;
    });
  }

  close(source: ConnectionImportSource | null): void {
    if (!this.visible && !this.resolvePending) return;
    this.visible = false;
    const resolve = this.resolvePending;
    this.resolvePending = null;
    this.fireDidChange();
    resolve?.(source);
  }

  onDidChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) listener();
  }
}

export const ConnectionImportSourceDialogService = new ConnectionImportSourceDialogServiceImpl();
