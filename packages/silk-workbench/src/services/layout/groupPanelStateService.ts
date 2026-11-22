import { readBrowserCopy, syncStored, writeStored } from "../storage/fileStore";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import type { EditorGroupId } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import { ContextKeyService } from "../../platform/context/contextKeyService";
import { LAYOUT_DEFAULTS, LAYOUT_MIN, LayoutService } from "./layoutService";

export type GroupPanelVisualState = {
  visible: boolean;
  size: number;
  maximized: boolean;
};

type InternalPanelState = GroupPanelVisualState & {
  sizeBeforeMaximize: { size: number; editorTabId?: string } | null;
};
type GroupPanelChangeListener = () => void;

/** Legacy shared size used as a fallback when an editor has no saved size. */
const PANEL_SIZE_STORAGE_KEY = "silk-workbench.groupPanelSize";
const EDITOR_PANEL_SIZES_STORAGE_KEY = "silk-workbench.editorPanelSizes";

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

function parseEditorPanelSizes(raw: string | null): Map<string, number> {
  try {
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return new Map();
  }
}

function loadPersistedEditorPanelSizes(): Map<string, number> {
  return parseEditorPanelSizes(readBrowserCopy(EDITOR_PANEL_SIZES_STORAGE_KEY));
}

class GroupPanelStateServiceImpl {
  private readonly states = new Map<EditorGroupId, InternalPanelState>();
  private readonly listeners = new Set<GroupPanelChangeListener>();
  private readonly initialPanelSize = loadPersistedPanelSize() ?? LAYOUT_DEFAULTS.panelSize;
  private readonly editorPanelSizes = loadPersistedEditorPanelSizes();

  /** Saved to the app's file; localStorage mirrors it for the next start. */
  private persistEditorPanelSizes(): void {
    writeStored("editor-panel-sizes", EDITOR_PANEL_SIZES_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.editorPanelSizes)), { cache: true });
  }

  constructor() {
    // Sizes found only in the file (e.g. after the browser copy was cleared) are added; no notification,
    // a pane reads its size when it is shown.
    void syncStored("editor-panel-sizes", () => readBrowserCopy(EDITOR_PANEL_SIZES_STORAGE_KEY), (text) => {
      for (const [tabId, size] of parseEditorPanelSizes(text)) {
        if (!this.editorPanelSizes.has(tabId)) this.editorPanelSizes.set(tabId, size);
      }
    });
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
      size: source?.size ?? this.initialPanelSize,
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

  getState(id: EditorGroupId, editorTabId?: string): GroupPanelVisualState {
    const state = this.ensure(id);
    const resolvedEditorTabId =
      editorTabId ?? EditorGroupsService.getGroupIfExists(id)?.getActiveTabId() ?? undefined;
    const size = resolvedEditorTabId
      ? (this.editorPanelSizes.get(resolvedEditorTabId) ?? this.initialPanelSize)
      : state.size;
    const { visible, maximized } = state;
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

  setPanelSize(id: EditorGroupId, size: number, editorTabId?: string): void {
    const state = this.ensure(id);
    const min =
      LayoutService.getPanelPosition() === "bottom"
        ? LAYOUT_MIN.panelSizeBottom
        : LAYOUT_MIN.panelSizeRight;
    const next = Math.max(min, Math.round(size));
    const resolvedEditorTabId =
      editorTabId ?? EditorGroupsService.getGroupIfExists(id)?.getActiveTabId() ?? undefined;
    const currentSize = resolvedEditorTabId
      ? (this.editorPanelSizes.get(resolvedEditorTabId) ?? this.initialPanelSize)
      : state.size;
    if (next === currentSize) return;
    if (resolvedEditorTabId) {
      this.editorPanelSizes.set(resolvedEditorTabId, next);
      this.persistEditorPanelSizes();
    } else {
      state.size = next;
    }
    if (state.maximized) {
      state.maximized = false;
      state.sizeBeforeMaximize = null;
    }
    this.commit(id);
  }

  toggleMaximized(id: EditorGroupId, editorTabId?: string): void {
    const state = this.ensure(id);
    const resolvedEditorTabId =
      editorTabId ?? EditorGroupsService.getGroupIfExists(id)?.getActiveTabId() ?? undefined;
    if (!state.visible) {
      state.visible = true;
    }
    if (state.maximized) {
      state.maximized = false;
      if (state.sizeBeforeMaximize !== null) {
        const { size, editorTabId: restoreEditorTabId } = state.sizeBeforeMaximize;
        if (restoreEditorTabId) {
          this.editorPanelSizes.set(restoreEditorTabId, size);
          this.persistEditorPanelSizes();
        } else {
          state.size = size;
        }
        state.sizeBeforeMaximize = null;
      }
    } else {
      state.sizeBeforeMaximize = {
        size: this.getState(id, resolvedEditorTabId).size,
        editorTabId: resolvedEditorTabId,
      };
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
