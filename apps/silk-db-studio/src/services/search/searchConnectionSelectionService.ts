type SearchConnectionSelectionListener = () => void;

/**
 * Which connection profiles the Search sidebar should search — `null` means "every profile"
 * (the default). Lives outside `SearchExplorer.tsx` because `Sidebar.tsx` only mounts that
 * component while the Search tab is active; switching to another sidebar tab and back would
 * otherwise lose the selection the user just made, which the "remember for the session" design
 * (see the search-sidebar requirements) explicitly rules out.
 */
class SearchConnectionSelectionServiceImpl {
  private selection: Set<string> | null = null;
  private readonly listeners = new Set<SearchConnectionSelectionListener>();

  getSelection(): Set<string> | null {
    return this.selection;
  }

  setSelection(selection: Set<string> | null): void {
    this.selection = selection;
    this.fireDidChange();
  }

  onDidChange(listener: SearchConnectionSelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const SearchConnectionSelectionService =
  new SearchConnectionSelectionServiceImpl();
