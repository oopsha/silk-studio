type ConnectionTargetListener = () => void;

class ConnectionTargetQuickPickServiceImpl {
  private open = false;
  private readonly listeners = new Set<ConnectionTargetListener>();

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

  toggle(): void {
    if (this.open) {
      this.hide();
    } else {
      this.show();
    }
  }

  onDidChange(listener: ConnectionTargetListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ConnectionTargetQuickPickService =
  new ConnectionTargetQuickPickServiceImpl();
