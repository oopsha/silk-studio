import { EditorServiceImpl } from "./editorService";
import { EditorHost } from "./editorHost";
import type { OpenEditorInput } from "./editorTypes";
import type { EditorSessionSnapshotV2 } from "./editorSessionTypes";
import {
  type EditorGroupId,
  type EditorLayoutNode,
  type SplitDirection,
  collectGroupIds,
  createInitialLayout,
  removeLeaf,
  resizeSplit,
  splitLeaf,
} from "./editorGroupTypes";

type EditorGroupsChangeListener = () => void;
type GroupLifecycleAddListener = (id: EditorGroupId, sourceId?: EditorGroupId) => void;
type GroupLifecycleRemoveListener = (id: EditorGroupId) => void;

function createGroupId(): EditorGroupId {
  return `group-${crypto.randomUUID()}`;
}

class EditorGroupsServiceImpl {
  private readonly groups = new Map<EditorGroupId, EditorServiceImpl>();
  private readonly groupUnsubs = new Map<EditorGroupId, () => void>();
  private layout: EditorLayoutNode;
  private focusedGroupId: EditorGroupId;
  private readonly listeners = new Set<EditorGroupsChangeListener>();
  /** Fires for every group's change, not just the focused one — session persistence needs this. */
  private readonly anyGroupListeners = new Set<EditorGroupsChangeListener>();
  /** Fires whenever a group is created/removed — lets other per-group state (e.g. panel layout) stay in sync without polling. */
  private readonly addListeners = new Set<GroupLifecycleAddListener>();
  private readonly removeListeners = new Set<GroupLifecycleRemoveListener>();
  private isRebuildingGroups = false;

  constructor() {
    const initialId = createGroupId();
    this.layout = createInitialLayout(initialId);
    this.focusedGroupId = initialId;
    this.registerGroup(initialId, new EditorServiceImpl());
  }

  private registerGroup(
    id: EditorGroupId,
    instance: EditorServiceImpl,
    sourceId?: EditorGroupId,
  ): void {
    this.groups.set(id, instance);
    // Must be configured before the group can possibly call openUntitled()
    // (e.g. ensureInitialTab()) — callers register before triggering that.
    instance.configureUntitledLabelFactory(() => this.nextUntitledLabel());
    const unsubscribeAggregate = instance.onDidChange(() => {
      if (this.focusedGroupId === id) {
        this.fireDidChange();
      }
    });
    // Every group pushes window-title/context-key updates to EditorHost on
    // its own mutations (see EditorServiceImpl.updateContextKeys), even when
    // unfocused. Re-derive from the focused group right after so an
    // unfocused group's change can't leave EditorHost showing its state.
    const unsubscribeHostSync = instance.onDidChange(() => {
      this.syncEditorHost();
    });
    const unsubscribeAnyGroup = instance.onDidChange(() => {
      this.fireAnyGroupDidChange();
    });
    this.groupUnsubs.set(id, () => {
      unsubscribeAggregate();
      unsubscribeHostSync();
      unsubscribeAnyGroup();
    });
    for (const listener of this.addListeners) {
      listener(id, sourceId);
    }
  }

  private syncEditorHost(): void {
    if (this.isRebuildingGroups) return;
    const active = this.getFocusedGroup().getActiveTab();
    EditorHost.setContextKey("activeEditorAvailable", Boolean(active));
    EditorHost.setContextKey("editorFocus", Boolean(active));
    EditorHost.setContextKey("resourceDirty", Boolean(active?.isDirty));
    EditorHost.updateWindowTitle(active);
  }

  private unregisterGroup(id: EditorGroupId): void {
    this.groupUnsubs.get(id)?.();
    this.groupUnsubs.delete(id);
    this.groups.delete(id);
    for (const listener of this.removeListeners) {
      listener(id);
    }
  }

  /**
   * Computed fresh from currently-open tabs across all groups (not a
   * persisted counter) so numbering is unique app-wide and naturally
   * resets to 1 once no Untitled tabs remain open anywhere.
   */
  private nextUntitledLabel(): string {
    let max = 0;
    for (const group of this.groups.values()) {
      for (const tab of group.getTabs()) {
        const match = /^Untitled-(\d+)$/.exec(tab.label);
        if (match) {
          max = Math.max(max, Number(match[1]));
        }
      }
    }
    return `Untitled-${max + 1}`;
  }

  getLayout(): EditorLayoutNode {
    return this.layout;
  }

  getGroupIds(): EditorGroupId[] {
    return collectGroupIds(this.layout);
  }

  getGroup(id: EditorGroupId): EditorServiceImpl {
    const group = this.groups.get(id);
    if (!group) {
      throw new Error(`[EditorGroupsService] unknown group id: ${id}`);
    }
    return group;
  }

  getFocusedGroupId(): EditorGroupId {
    return this.focusedGroupId;
  }

  getFocusedGroup(): EditorServiceImpl {
    return this.getGroup(this.focusedGroupId);
  }

  setFocusedGroup(id: EditorGroupId): void {
    if (this.focusedGroupId === id || !this.groups.has(id)) return;
    this.focusedGroupId = id;
    this.syncEditorHost();
    this.fireDidChange();
    this.fireAnyGroupDidChange();
  }

  /** Splits `sourceId` into two groups, focuses the new one, and returns its id. */
  splitGroup(sourceId: EditorGroupId, direction: "right"): EditorGroupId {
    const splitDirection: SplitDirection = direction === "right" ? "row" : "row";
    const newGroupId = createGroupId();
    const newGroup = new EditorServiceImpl();
    // `enablePreviewEditors` is meant to be a global setting, not per-group —
    // seed it from the source group so a fresh split doesn't silently reset it.
    newGroup.setEnablePreviewEditors(
      this.getGroup(sourceId).getEnablePreviewEditors(),
    );
    // Register before ensureInitialTab(): it may call openUntitled(), which
    // needs the untitled-label factory registerGroup() configures.
    this.registerGroup(newGroupId, newGroup, sourceId);
    newGroup.ensureInitialTab();
    this.layout = splitLeaf(this.layout, sourceId, splitDirection, newGroupId);
    this.focusedGroupId = newGroupId;
    this.syncEditorHost();
    this.fireDidChange();
    this.fireAnyGroupDidChange();
    return newGroupId;
  }

  /** Closes `id`. No-op when it is the last remaining group. */
  closeGroup(id: EditorGroupId): void {
    if (this.getGroupIds().length <= 1) return;
    const nextLayout = removeLeaf(this.layout, id);
    if (!nextLayout) return;

    this.layout = nextLayout;
    this.unregisterGroup(id);
    if (this.focusedGroupId === id) {
      this.focusedGroupId = this.getGroupIds()[0]!;
    }
    this.syncEditorHost();
    this.fireDidChange();
    this.fireAnyGroupDidChange();
  }

  /** Closes a tab; if that empties the group, closes the group too (unless it's the last one). */
  closeTab(groupId: EditorGroupId, tabId: string): void {
    const group = this.getGroup(groupId);
    group.closeTab(tabId);
    this.collapseIfEmpty(groupId, group);
  }

  closeActiveTab(groupId: EditorGroupId): void {
    const group = this.getGroup(groupId);
    const active = group.getActiveTab();
    if (!active) return;
    group.closeTab(active.id);
    this.collapseIfEmpty(groupId, group);
  }

  closeAllTabsInGroup(groupId: EditorGroupId): void {
    const group = this.getGroup(groupId);
    group.closeAllTabs();
    this.collapseIfEmpty(groupId, group);
  }

  private collapseIfEmpty(groupId: EditorGroupId, group: EditorServiceImpl): void {
    if (group.getTabs().length > 0) return;
    if (this.getGroupIds().length > 1) {
      this.closeGroup(groupId);
    }
    // Sole remaining group: leave it with 0 tabs — EditorArea already
    // renders an empty state rather than inventing a new Untitled tab.
  }

  setSplitRatio(splitId: string, sizes: number[]): void {
    this.layout = resizeSplit(this.layout, splitId, sizes);
    this.fireDidChange();
    this.fireAnyGroupDidChange();
  }

  /**
   * Opens a file, revealing/focusing it in whichever group already has it
   * open instead of creating a duplicate tab pointing at the same Monaco model.
   */
  openFile(path: string, content: string, preview?: boolean): string {
    const existing = this.revealByUri(path, preview);
    if (existing) return existing;
    return this.getFocusedGroup().openFile(path, content, preview);
  }

  openEditor(input: OpenEditorInput): string {
    if (input.uri) {
      const existing = this.revealByUri(input.uri, input.preview);
      if (existing) return existing;
    }
    return this.getFocusedGroup().openEditor(input);
  }

  private revealByUri(uri: string, preview?: boolean): string | null {
    for (const [groupId, group] of this.groups) {
      const tab = group.getTabs().find((item) => item.uri === uri);
      if (!tab) continue;
      this.setFocusedGroup(groupId);
      group.setActiveTab(tab.id);
      if (!preview) group.pinTab(tab.id);
      return tab.id;
    }
    return null;
  }

  prepareSessionRestore(): void {
    this.getFocusedGroup().prepareSessionRestore();
  }

  captureSessionSnapshot(): EditorSessionSnapshotV2 {
    return {
      version: 2,
      savedAt: Date.now(),
      layout: this.layout,
      focusedGroupId: this.focusedGroupId,
      groups: [...this.groups.entries()].map(([groupId, group]) => ({
        groupId,
        ...group.captureSessionSnapshot(),
      })),
    };
  }

  /**
   * Replace all groups with a Hot Exit snapshot. Falls back to a single
   * fresh group (which opens Untitled) when `snapshot` is null/empty/corrupt.
   */
  applySessionSnapshot(snapshot: EditorSessionSnapshotV2 | null): void {
    // While groups are torn down and rebuilt below, `this.focusedGroupId`
    // transiently points at an already-unregistered group — each group's own
    // onDidChange (fired by its applySessionSnapshot) would otherwise trigger
    // syncEditorHost()/getFocusedGroup() against that dangling id and throw.
    this.isRebuildingGroups = true;
    try {
      for (const id of [...this.groups.keys()]) {
        this.unregisterGroup(id);
      }

      if (!snapshot || !this.restoreFromSnapshot(snapshot)) {
        const id = createGroupId();
        this.layout = createInitialLayout(id);
        this.focusedGroupId = id;
        const group = new EditorServiceImpl();
        this.registerGroup(id, group);
        group.applySessionSnapshot(null);
      }
    } finally {
      this.isRebuildingGroups = false;
    }

    this.syncEditorHost();
    this.fireDidChange();
    this.fireAnyGroupDidChange();
  }

  /** Returns false (no groups registered) when the snapshot's layout/groups don't line up. */
  private restoreFromSnapshot(snapshot: EditorSessionSnapshotV2): boolean {
    const layoutGroupIds = collectGroupIds(snapshot.layout);
    const snapshotGroupIds = new Set(snapshot.groups.map((entry) => entry.groupId));
    const isConsistent =
      layoutGroupIds.length > 0 &&
      layoutGroupIds.length === snapshotGroupIds.size &&
      layoutGroupIds.every((id) => snapshotGroupIds.has(id));
    if (!isConsistent) return false;

    for (const groupSnapshot of snapshot.groups) {
      const group = new EditorServiceImpl();
      this.registerGroup(groupSnapshot.groupId, group);
      group.applySessionSnapshot(groupSnapshot);
    }
    this.layout = snapshot.layout;
    this.focusedGroupId = this.groups.has(snapshot.focusedGroupId)
      ? snapshot.focusedGroupId
      : layoutGroupIds[0]!;
    return true;
  }

  /** `enablePreviewEditors` is a global setting mirrored onto every group instance. */
  setEnablePreviewEditors(enabled: boolean): void {
    for (const group of this.groups.values()) {
      group.setEnablePreviewEditors(enabled);
    }
  }

  toggleEnablePreviewEditors(): void {
    this.setEnablePreviewEditors(!this.getFocusedGroup().getEnablePreviewEditors());
  }

  onDidChange(listener: EditorGroupsChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Like {@link onDidChange}, but fires for every group's own change, not
   * just the focused group's — required for session persistence, which must
   * capture edits made in an unfocused pane too.
   */
  onDidChangeAnyGroup(listener: EditorGroupsChangeListener): () => void {
    this.anyGroupListeners.add(listener);
    return () => this.anyGroupListeners.delete(listener);
  }

  /** Fires once a new group is registered (initial group, split, or session restore). */
  onDidAddGroup(listener: GroupLifecycleAddListener): () => void {
    this.addListeners.add(listener);
    return () => this.addListeners.delete(listener);
  }

  /** Fires once a group is torn down (close, or session-restore rebuild). */
  onDidRemoveGroup(listener: GroupLifecycleRemoveListener): () => void {
    this.removeListeners.add(listener);
    return () => this.removeListeners.delete(listener);
  }

  private fireDidChange(): void {
    // See applySessionSnapshot: layout/groups are transiently inconsistent
    // mid-rebuild, so external listeners must not observe intermediate state.
    if (this.isRebuildingGroups) return;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private fireAnyGroupDidChange(): void {
    if (this.isRebuildingGroups) return;
    for (const listener of this.anyGroupListeners) {
      listener();
    }
  }
}

export const EditorGroupsService = new EditorGroupsServiceImpl();
