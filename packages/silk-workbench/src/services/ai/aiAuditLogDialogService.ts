type AiAuditLogDialogListener = () => void;

class AiAuditLogDialogServiceImpl {
  private open = false;
  private readonly listeners = new Set<AiAuditLogDialogListener>();

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.fireDidChange();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.fireDidChange();
  }

  onDidChange(listener: AiAuditLogDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const AiAuditLogDialogService = new AiAuditLogDialogServiceImpl();
