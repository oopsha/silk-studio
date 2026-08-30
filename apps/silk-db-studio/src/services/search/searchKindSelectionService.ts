import type { MetadataObjectKind } from "@silk-studio/db-protocol";

/** Every kind the Search sidebar can restrict its query to. */
export const ALL_SEARCH_KINDS: MetadataObjectKind[] = [
  "table",
  "view",
  "procedure",
  "function",
  "package",
  "trigger",
  "index",
  "sequence",
  "synonym",
  "type",
];

/**
 * Index/synonym are excluded by default: an index match is almost always just the
 * auto-generated (or DBA-named-like-the-constraint) index backing a PK/UNIQUE/FK constraint,
 * and a synonym match is almost always the same name as the real object it points to — in both
 * cases the user is looking for the underlying table/view, not the alias/constraint artifact.
 * Still selectable, just off by default.
 */
const DEFAULT_SEARCH_KINDS = new Set<MetadataObjectKind>(
  ALL_SEARCH_KINDS.filter((kind) => kind !== "index" && kind !== "synonym"),
);

type SearchKindSelectionListener = () => void;

/**
 * Which object kinds the Search sidebar restricts its query to — session-only, same rationale
 * as `SearchConnectionSelectionService` (lives outside `SearchExplorer.tsx` since `Sidebar.tsx`
 * only mounts that component while the Search tab is active). Unlike the connection selection,
 * there's no "everything" sentinel here: the default itself is a deliberate subset (see
 * `DEFAULT_SEARCH_KINDS`), so the selection is always a concrete `Set`.
 */
class SearchKindSelectionServiceImpl {
  private selection: Set<MetadataObjectKind> = new Set(DEFAULT_SEARCH_KINDS);
  private readonly listeners = new Set<SearchKindSelectionListener>();

  getSelection(): Set<MetadataObjectKind> {
    return this.selection;
  }

  setSelection(selection: Set<MetadataObjectKind>): void {
    this.selection = selection;
    this.fireDidChange();
  }

  onDidChange(listener: SearchKindSelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const SearchKindSelectionService = new SearchKindSelectionServiceImpl();
