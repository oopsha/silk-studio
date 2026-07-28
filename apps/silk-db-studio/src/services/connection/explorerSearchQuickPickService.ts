type ExplorerSearchListener = () => void;

class ExplorerSearchQuickPickServiceImpl {
  private open = false;
  private readonly listeners = new Set<ExplorerSearchListener>();

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    if (this.open) {
      this.fireDidChange();
      return;
    }
    this.open = true;
    this.fireDidChange();
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
