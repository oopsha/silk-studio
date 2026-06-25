type TabBarActionListener = () => void;

class TabBarActionServiceImpl {
  private readonly showOpenEditorsListeners = new Set<TabBarActionListener>();

  requestShowOpenEditors(): void {
    for (const listener of this.showOpenEditorsListeners) {
      listener();
    }
  }

  onRequestShowOpenEditors(listener: TabBarActionListener): () => void {
    this.showOpenEditorsListeners.add(listener);
    return () => this.showOpenEditorsListeners.delete(listener);
  }
}

export const TabBarActionService = new TabBarActionServiceImpl();
