export type ConnectionExportDialogProfile = {
  id: string;
  name: string;
  driverId: string;
};

export type ConnectionExportDialogRequest = {
  profiles: ConnectionExportDialogProfile[];
};

export type ConnectionExportDialogResult =
  | { confirmed: true; profileIds: string[] }
  | { confirmed: false };

type ConnectionExportDialogListener = () => void;

class ConnectionExportDialogServiceImpl {
  private request: ConnectionExportDialogRequest | null = null;
  private pendingResolve:
    | ((result: ConnectionExportDialogResult) => void)
    | null = null;
  private readonly listeners = new Set<ConnectionExportDialogListener>();

  getRequest(): ConnectionExportDialogRequest | null {
    return this.request;
  }

  open(profiles: ConnectionExportDialogProfile[]): Promise<ConnectionExportDialogResult> {
    if (this.pendingResolve) {
      this.pendingResolve({ confirmed: false });
      this.pendingResolve = null;
    }

    this.request = { profiles };
    this.fireDidChange();
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(result: ConnectionExportDialogResult): void {
    if (!this.request && !this.pendingResolve) return;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.fireDidChange();
    resolve?.(result);
  }

  onDidChange(listener: ConnectionExportDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ConnectionExportDialogService = new ConnectionExportDialogServiceImpl();
