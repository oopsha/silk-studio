export type ConfirmDialogRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive (red) style. */
  danger?: boolean;
};

type ConfirmDialogListener = () => void;

/**
 * In-app replacement for `window.confirm(...)` — kept because native `window.confirm` was found
 * to silently resolve without ever showing a dialog in this Tauri/WebView2 shell (confirmed by a
 * user losing a connection profile to a one-click delete that was supposed to be gated by
 * `window.confirm`). Every destructive-action confirmation in this app should go through this
 * service instead of the native dialog.
 */
class ConfirmDialogServiceImpl {
  private request: ConfirmDialogRequest | null = null;
  private pendingResolve: ((confirmed: boolean) => void) | null = null;
  private readonly listeners = new Set<ConfirmDialogListener>();

  getRequest(): ConfirmDialogRequest | null {
    return this.request;
  }

  /** Resolves `true` if the user confirms, `false` if they cancel or dismiss the dialog. */
  confirm(request: ConfirmDialogRequest): Promise<boolean> {
    if (this.pendingResolve) {
      this.pendingResolve(false);
      this.pendingResolve = null;
    }
    this.request = request;
    this.fireDidChange();
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(confirmed: boolean): void {
    if (!this.request && !this.pendingResolve) return;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.fireDidChange();
    resolve?.(confirmed);
  }

  onDidChange(listener: ConfirmDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ConfirmDialogService = new ConfirmDialogServiceImpl();
