type ExplorerSearchListener = () => void;

export type ExplorerSearchQuickPickShowOptions = {
  /** Pre-fill the filter box instead of opening empty (e.g. from a Ctrl+Space fallback item). */
  initialFilter?: string;
  /** Immediately run the "search all connections" live query for `initialFilter`, as if the
   *  user had opened the pick and clicked that action themselves. */
  autoRunLiveSearch?: boolean;
};

class ExplorerSearchQuickPickServiceImpl {
  private open = false;
  private readonly listeners = new Set<ExplorerSearchListener>();
  private pendingRequest: ExplorerSearchQuickPickShowOptions | null = null;

  isOpen(): boolean {
    return this.open;
  }

  /**
   * `initialFilter`/`autoRunLiveSearch` are consumed once via {@link consumePendingRequest} —
   * called again while already open (e.g. a second Ctrl+Space fallback click before the modal
   * was closed) still applies the new request, it doesn't silently no-op.
   */
  show(options?: ExplorerSearchQuickPickShowOptions): void {
    this.pendingRequest = options ?? null;
    if (this.open) {
      this.fireDidChange();
      return;
    }
    this.open = true;
    this.fireDidChange();
  }

  /** Read-once: returns and clears whatever `show()` was last called with. */
  consumePendingRequest(): ExplorerSearchQuickPickShowOptions | null {
    const request = this.pendingRequest;
    this.pendingRequest = null;
    return request;
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.fireDidChange();
  }

  onDidChange(listener: ExplorerSearchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ExplorerSearchQuickPickService =
  new ExplorerSearchQuickPickServiceImpl();
