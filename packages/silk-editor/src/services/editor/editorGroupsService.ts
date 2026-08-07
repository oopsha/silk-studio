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
  private isRebuildingGroups = false;

  constructor() {
    const initialId = createGroupId();
    this.layout = createInitialLayout(initialId);
    this.focusedGroupId = initialId;
    this.registerGroup(initialId, new EditorServiceImpl());
  }

  private registerGroup(id: EditorGroupId, instance: EditorServiceImpl): void {
    this.groups.set(id, instance);
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
    newGroup.ensureInitialTab();
    this.registerGroup(newGroupId, newGroup);
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

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private fireAnyGroupDidChange(): void {
    for (const listener of this.anyGroupListeners) {
      listener();
    }
  }
}

export const EditorGroupsService = new EditorGroupsServiceImpl();
