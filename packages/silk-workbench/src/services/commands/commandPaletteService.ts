type CommandPaletteListener = () => void;

class CommandPaletteServiceImpl {
  private open = false;
  private readonly listeners = new Set<CommandPaletteListener>();

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
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

  onDidChange(listener: CommandPaletteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const CommandPaletteService = new CommandPaletteServiceImpl();
