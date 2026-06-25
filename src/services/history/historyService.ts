import { ContextKeyService } from "../../platform/context/contextKeyService";

export type NavigationLocation = {
  label: string;
  uri?: string;
};

type HistoryChangeListener = () => void;

class HistoryServiceImpl {
  private readonly backStack: NavigationLocation[] = [];
  private readonly forwardStack: NavigationLocation[] = [];
  private readonly listeners = new Set<HistoryChangeListener>();

  push(location: NavigationLocation): void {
    this.backStack.push(location);
    this.forwardStack.length = 0;
    this.updateContextKeys();
  }

  goBack(): void {
    if (!this.canGoBack()) return;

    const current = this.backStack.pop();
    if (current) {
      this.forwardStack.push(current);
    }
    this.updateContextKeys();
    this.fireDidChange();
  }

  goForward(): void {
    if (!this.canGoForward()) return;

    const next = this.forwardStack.pop();
    if (next) {
      this.backStack.push(next);
    }
    this.updateContextKeys();
    this.fireDidChange();
  }

  canGoBack(): boolean {
    return this.backStack.length > 1;
  }

  canGoForward(): boolean {
    return this.forwardStack.length > 0;
  }

  onDidChange(listener: HistoryChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private updateContextKeys(): void {
    ContextKeyService.set("canNavigateBack", this.canGoBack());
    ContextKeyService.set("canNavigateForward", this.canGoForward());
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Sets the initial location when history is empty. */
  seed(location: NavigationLocation): void {
    if (this.backStack.length > 0) return;
    this.backStack.push(location);
    this.updateContextKeys();
  }
}

export const HistoryService = new HistoryServiceImpl();
