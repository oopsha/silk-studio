import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import type { EditorGroupId } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import { ContextKeyService } from "../../platform/context/contextKeyService";
import { LAYOUT_DEFAULTS, LAYOUT_MIN, LayoutService } from "./layoutService";

export type GroupPanelVisualState = {
  visible: boolean;
  size: number;
  maximized: boolean;
};

type InternalPanelState = GroupPanelVisualState & { sizeBeforeMaximize: number | null };
type GroupPanelChangeListener = () => void;

/** Last user-resized panel size, shared across groups so a restart (or a new
 * split) keeps the size the user actually chose instead of the built-in default. */
const PANEL_SIZE_STORAGE_KEY = "silk-workbench.groupPanelSize";

function loadPersistedPanelSize(): number | null {
  try {
    const raw = localStorage.getItem(PANEL_SIZE_STORAGE_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function savePersistedPanelSize(size: number): void {
  try {
    localStorage.setItem(PANEL_SIZE_STORAGE_KEY, String(size));
  } catch {
    // Ignore quota or private-mode errors.
  }
}

class GroupPanelStateServiceImpl {
  private readonly states = new Map<EditorGroupId, InternalPanelState>();
  private readonly listeners = new Set<GroupPanelChangeListener>();
  private persistedSize = loadPersistedPanelSize();

  constructor() {
    for (const id of EditorGroupsService.getGroupIds()) {
      this.seed(id);
    }
    // Deliberately no fireDidChange() here: EditorGroupsService.onDidAddGroup/
    // onDidRemoveGroup fire even mid session-restore rebuild (while its own
    // layout/group map is transiently inconsistent — see EditorGroupsService.
    // applySessionSnapshot), so notifying React subscribers synchronously here
    // would re-render still-mounted panes for groups already unregistered.
    // A freshly mounted group's pane reads state directly via useGroupPanelState's
    // lazy initializer, so no separate change notification is needed on add;
    // a removed group's pane simply unmounts, so none is needed on remove either.
    EditorGroupsService.onDidAddGroup((id, sourceId) => {
      this.seed(id, sourceId);
      this.syncContextKeys();
    });
    EditorGroupsService.onDidRemoveGroup((id) => {
      this.states.delete(id);
      this.syncContextKeys();
    });
    EditorGroupsService.onDidChange(() => this.syncContextKeys());
    this.syncContextKeys();
  }

  private seed(id: EditorGroupId, sourceId?: EditorGroupId): void {
    if (this.states.has(id)) return;
    const source = sourceId ? this.states.get(sourceId) : undefined;
    this.states.set(id, {
      visible: source?.visible ?? LAYOUT_DEFAULTS.panel,
      size: source?.size ?? this.persistedSize ?? LAYOUT_DEFAULTS.panelSize,
      maximized: false,
      sizeBeforeMaximize: null,
    });
  }

  private ensure(id: EditorGroupId): InternalPanelState {
    let state = this.states.get(id);
    if (!state) {
      this.seed(id);
      state = this.states.get(id)!;
    }
    return state;
  }

  getState(id: EditorGroupId): GroupPanelVisualState {
    const { visible, size, maximized } = this.ensure(id);
    return { visible, size, maximized };
  }

  showPanel(id: EditorGroupId): void {
    const state = this.ensure(id);
    if (state.visible) return;
    state.visible = true;
    this.commit(id);
  }

  togglePanel(id: EditorGroupId): void {
    const state = this.ensure(id);
    state.visible = !state.visible;
    if (!state.visible) {
      state.maximized = false;
      state.sizeBeforeMaximize = null;
    }
    this.commit(id);
  }

  setPanelSize(id: EditorGroupId, size: number): void {
    const state = this.ensure(id);
    const min =
      LayoutService.getPanelPosition() === "bottom"
        ? LAYOUT_MIN.panelSizeBottom
        : LAYOUT_MIN.panelSizeRight;
    const next = Math.max(min, Math.round(size));
    if (next === state.size) return;
    state.size = next;
    if (state.maximized) {
      state.maximized = false;
      state.sizeBeforeMaximize = null;
    }
    this.persistedSize = next;
    savePersistedPanelSize(next);
    this.commit(id);
  }

  toggleMaximized(id: EditorGroupId): void {
    const state = this.ensure(id);
    if (!state.visible) {
      state.visible = true;
    }
    if (state.maximized) {
      state.maximized = false;
      if (state.sizeBeforeMaximize !== null) {
        state.size = state.sizeBeforeMaximize;
        state.sizeBeforeMaximize = null;
      }
    } else {
      state.sizeBeforeMaximize = state.size;
      state.maximized = true;
    }
    this.commit(id);
  }

  onDidChange(listener: GroupPanelChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(id: EditorGroupId): void {
    if (id === EditorGroupsService.getFocusedGroupId()) {
      this.syncContextKeys();
    }
    this.fireDidChange();
  }

  /** panelVisible/panelMaximized context keys track the *focused* group's panel. */
  private syncContextKeys(): void {
    const focused = this.getState(EditorGroupsService.getFocusedGroupId());
    ContextKeyService.set("panelVisible", focused.visible);
    ContextKeyService.set("panelMaximized", focused.maximized);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const GroupPanelStateService = new GroupPanelStateServiceImpl();
