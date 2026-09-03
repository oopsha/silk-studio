import type { SshSecretKind } from "./sshTunnelSecretBridge";

export type SshSecretPromptRequest = {
  profileName: string;
  /** Which secrets are actually missing for this connect attempt — 1 or 2 (main hop + second hop). */
  fields: SshSecretKind[];
};

export type SshSecretPromptResult =
  | { confirmed: true; values: Partial<Record<SshSecretKind, string>>; save: boolean }
  | { confirmed: false };

type Listener = () => void;

/**
 * Prompts for an SSH tunnel's missing password/passphrase at connect time — same rationale as
 * `ConnectionPasswordPromptService` for the DB password: most commonly right after importing
 * connection profiles, which never carry secrets (see `connectionExportService.ts`). Only shown
 * for user-initiated (non-silent) connects. Can ask for up to two fields at once (the main hop's
 * secret and, if a second SSH hop is configured, its own secret too) in one dialog.
 */
class SshSecretPromptServiceImpl {
  private request: SshSecretPromptRequest | null = null;
  private pendingResolve: ((result: SshSecretPromptResult) => void) | null = null;
  private readonly listeners = new Set<Listener>();

  getRequest(): SshSecretPromptRequest | null {
    return this.request;
  }

  open(profileName: string, fields: SshSecretKind[]): Promise<SshSecretPromptResult> {
    if (this.pendingResolve) {
      this.pendingResolve({ confirmed: false });
      this.pendingResolve = null;
    }

    this.request = { profileName, fields };
    this.fireDidChange();
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(result: SshSecretPromptResult): void {
    if (!this.request && !this.pendingResolve) return;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.fireDidChange();
    resolve?.(result);
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

export const SshSecretPromptService = new SshSecretPromptServiceImpl();
