export type PackagePlsqlSaveSection = {
  id: "spec" | "body";
  label: string;
  /** Current editor buffer — always available immediately. */
  after: string;
  /** Live DB source at dialog-open time (for Diff), fetched fresh like `PlsqlSaveDialogService`
   * does — null while loading / on failure. */
  before: string | null;
  beforeLoading: boolean;
  beforeError: string | null;
};

export type PackagePlsqlSaveDialogRequest = {
  objectLabel: string;
  sections: PackagePlsqlSaveSection[];
  warnings: string[];
  onConfirm: () => Promise<void>;
};

type Listener = () => void;

let nextNonce = 1;

/**
 * Package Spec/Body local-buffer save preview — unlike `PlsqlSaveDialogService`, this has no
 * `tabId`: the package editor manages Spec/Body as plain component state rather than
 * `EditorService` tabs (see PackageDdlEditorView's doc comment), so confirming here just invokes
 * the caller-supplied `onConfirm` instead of the tab-coupled `executePlsqlSave`.
 */
class PackagePlsqlSaveDialogServiceImpl {
  private request: PackagePlsqlSaveDialogRequest | null = null;
  private nonce = 0;
  private readonly listeners = new Set<Listener>();

  getRequest(): PackagePlsqlSaveDialogRequest | null {
    return this.request;
  }

  /** Returns a nonce identifying this open() call — pass it back to `patchSection` so a stale
   * async fetch from a dialog that's since been closed and reopened can't patch the wrong one. */
  open(request: PackagePlsqlSaveDialogRequest): number {
    this.request = request;
    this.nonce = nextNonce++;
    this.fireDidChange();
    return this.nonce;
  }

  /** Patches one section by id — used once each section's live DB source finishes loading. */
  patchSection(nonce: number, id: "spec" | "body", partial: Partial<PackagePlsqlSaveSection>): void {
    if (!this.request || this.nonce !== nonce) return;
    this.request = {
      ...this.request,
      sections: this.request.sections.map((section) =>
        section.id === id ? { ...section, ...partial } : section,
      ),
    };
    this.fireDidChange();
  }

  close(): void {
    if (!this.request) return;
    this.request = null;
    this.fireDidChange();
  }

  onDidChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const PackagePlsqlSaveDialogService = new PackagePlsqlSaveDialogServiceImpl();
