type ExplorerUiListener = () => void;

export type ExplorerExpandSchemaRequest = {
  profileId: string;
  schemaName: string;
};

/**
 * Lightweight UI coordination for the Connections explorer
 * (collapse-all, expand-after-preload) without coupling React trees.
 */
class ExplorerUiServiceImpl {
  private collapseGeneration = 0;
  private expandRequest: ExplorerExpandSchemaRequest | null = null;
  private readonly listeners = new Set<ExplorerUiListener>();

  getCollapseGeneration(): number {
    return this.collapseGeneration;
  }

  getExpandRequest(): ExplorerExpandSchemaRequest | null {
    return this.expandRequest;
  }

  collapseAll(): void {
    this.collapseGeneration += 1;
    this.fireDidChange();
  }

  requestExpandSchema(profileId: string, schemaName: string): void {
    this.expandRequest = { profileId, schemaName };
    this.fireDidChange();
  }

  clearExpandRequest(): void {
    if (!this.expandRequest) return;
    this.expandRequest = null;
    this.fireDidChange();
  }

  onDidChange(listener: ExplorerUiListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ExplorerUiService = new ExplorerUiServiceImpl();
