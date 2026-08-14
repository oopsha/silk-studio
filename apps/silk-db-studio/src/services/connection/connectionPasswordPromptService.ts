export type ConnectionPasswordPromptRequest = {
  profileName: string;
};

export type ConnectionPasswordPromptResult =
  | { confirmed: true; password: string; save: boolean }
  | { confirmed: false };

type ConnectionPasswordPromptListener = () => void;

/**
 * Prompts for a connection's password when it's missing at connect time — most commonly right
 * after importing connection profiles, which never carry a password (see
 * `connectionExportService.ts`). Only shown for user-initiated (non-silent) connects; a silent
 * auto-connect (app startup, running a query against a disconnected profile) just fails as
 * before rather than popping up a modal unprompted.
 */
class ConnectionPasswordPromptServiceImpl {
  private request: ConnectionPasswordPromptRequest | null = null;
  private pendingResolve:
    | ((result: ConnectionPasswordPromptResult) => void)
    | null = null;
  private readonly listeners = new Set<ConnectionPasswordPromptListener>();

  getRequest(): ConnectionPasswordPromptRequest | null {
    return this.request;
  }

  open(profileName: string): Promise<ConnectionPasswordPromptResult> {
    if (this.pendingResolve) {
      this.pendingResolve({ confirmed: false });
      this.pendingResolve = null;
    }

    this.request = { profileName };
    this.fireDidChange();
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(result: ConnectionPasswordPromptResult): void {
    if (!this.request && !this.pendingResolve) return;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.fireDidChange();
    resolve?.(result);
  }

  onDidChange(listener: ConnectionPasswordPromptListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ConnectionPasswordPromptService = new ConnectionPasswordPromptServiceImpl();
