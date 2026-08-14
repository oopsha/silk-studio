export type ConnectionImportCandidate = {
  /** Index into the source file's `profiles` array — the stable key for this dialog session. */
  index: number;
  name: string;
  driverLabel: string;
  hostPort: string;
  database: string;
  user: string;
  tunnel: "none" | "ssm" | "ssh";
  /** An existing local profile has the exact same name. */
  nameConflict: boolean;
  /** An existing local profile targets the same driver+host+port+user+database. */
  connectionConflict: boolean;
};

export type ConnectionImportDialogRequest = {
  candidates: ConnectionImportCandidate[];
};

export type ConnectionImportDialogResult =
  | { confirmed: true; indexes: number[] }
  | { confirmed: false };

type ConnectionImportDialogListener = () => void;

class ConnectionImportDialogServiceImpl {
  private request: ConnectionImportDialogRequest | null = null;
  private pendingResolve:
    | ((result: ConnectionImportDialogResult) => void)
    | null = null;
  private readonly listeners = new Set<ConnectionImportDialogListener>();

  getRequest(): ConnectionImportDialogRequest | null {
    return this.request;
  }

  open(candidates: ConnectionImportCandidate[]): Promise<ConnectionImportDialogResult> {
    if (this.pendingResolve) {
      this.pendingResolve({ confirmed: false });
      this.pendingResolve = null;
    }

    this.request = { candidates };
    this.fireDidChange();
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(result: ConnectionImportDialogResult): void {
    if (!this.request && !this.pendingResolve) return;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.fireDidChange();
    resolve?.(result);
  }

  onDidChange(listener: ConnectionImportDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ConnectionImportDialogService = new ConnectionImportDialogServiceImpl();
