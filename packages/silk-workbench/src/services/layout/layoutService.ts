import { ContextKeyService } from "../../platform/context/contextKeyService";
import { loadLayoutState, saveLayoutState } from "./layoutStorage";

export type PanelPosition = "bottom" | "right";

export type LayoutVisibility = {
  sidebar: boolean;
  panel: boolean;
  auxiliaryBar: boolean;
};

export type LayoutDimensions = {
  sidebarWidth: number;
  panelSize: number;
  auxiliaryBarWidth: number;
};

export type LayoutState = LayoutVisibility &
  LayoutDimensions & {
    panelPosition: PanelPosition;
    panelMaximized: boolean;
  };

type LayoutChangeListener = () => void;

export const LAYOUT_DEFAULTS: LayoutState = {
  sidebarWidth: 260,
  panelSize: 260,
  auxiliaryBarWidth: 320,
  panelPosition: "bottom",
  panelMaximized: false,
  sidebar: true,
  panel: false,
  auxiliaryBar: false,
};

export const LAYOUT_MIN = {
  sidebarWidth: 170,
  panelSizeBottom: 80,
  panelSizeRight: 200,
  auxiliaryBarWidth: 200,
} as const;

class LayoutServiceImpl {
  private sidebarVisible = LAYOUT_DEFAULTS.sidebar;
  private panelVisible = LAYOUT_DEFAULTS.panel;
  private auxiliaryBarVisible = LAYOUT_DEFAULTS.auxiliaryBar;
  private sidebarWidth = LAYOUT_DEFAULTS.sidebarWidth;
  private panelSize = LAYOUT_DEFAULTS.panelSize;
  private auxiliaryBarWidth = LAYOUT_DEFAULTS.auxiliaryBarWidth;
  private panelPosition: PanelPosition = LAYOUT_DEFAULTS.panelPosition;
  private panelMaximized = LAYOUT_DEFAULTS.panelMaximized;
  private panelSizeBeforeMaximize: number | null = null;
  private readonly listeners = new Set<LayoutChangeListener>();

  constructor() {
    this.restoreFromStorage();
    this.updateContextKeys();
  }

  getState(): LayoutState {
    return {
      sidebar: this.sidebarVisible,
      panel: this.panelVisible,
      auxiliaryBar: this.auxiliaryBarVisible,
      sidebarWidth: this.sidebarWidth,
      panelSize: this.panelSize,
      auxiliaryBarWidth: this.auxiliaryBarWidth,
      panelPosition: this.panelPosition,
      panelMaximized: this.panelMaximized,
    };
  }

  getVisibility(): LayoutVisibility {
    const { sidebar, panel, auxiliaryBar } = this.getState();
    return { sidebar, panel, auxiliaryBar };
  }

  getDimensions(): LayoutDimensions {
    const { sidebarWidth, panelSize, auxiliaryBarWidth } = this.getState();
    return { sidebarWidth, panelSize, auxiliaryBarWidth };
  }

  getPanelPosition(): PanelPosition {
    return this.panelPosition;
  }

  isPanelMaximized(): boolean {
    return this.panelMaximized;
  }

  toggleSidebar(): void {
    this.sidebarVisible = !this.sidebarVisible;
    this.commit();
  }

  showSidebar(): void {
    if (this.sidebarVisible) return;
    this.sidebarVisible = true;
    this.commit();
  }

  hideSidebar(): void {
    if (!this.sidebarVisible) return;
    this.sidebarVisible = false;
    this.commit();
  }

  isSidebarVisible(): boolean {
    return this.sidebarVisible;
  }

  togglePanel(): void {
    this.panelVisible = !this.panelVisible;
    if (!this.panelVisible) {
      this.panelMaximized = false;
      this.panelSizeBeforeMaximize = null;
    }
    this.commit();
  }

  showPanel(): void {
    if (this.panelVisible) return;
    this.panelVisible = true;
    this.commit();
  }

  toggleAuxiliaryBar(): void {
    this.auxiliaryBarVisible = !this.auxiliaryBarVisible;
    this.commit();
  }

  setSidebarWidth(width: number): void {
    const next = Math.max(LAYOUT_MIN.sidebarWidth, Math.round(width));
    if (next === this.sidebarWidth) return;
    this.sidebarWidth = next;
    this.commit();
  }

  setPanelSize(size: number): void {
    const min =
      this.panelPosition === "bottom"
        ? LAYOUT_MIN.panelSizeBottom
        : LAYOUT_MIN.panelSizeRight;
    const next = Math.max(min, Math.round(size));
    if (next === this.panelSize) return;
    this.panelSize = next;
    if (this.panelMaximized) {
      this.panelMaximized = false;
      this.panelSizeBeforeMaximize = null;
    }
    this.commit();
  }

  setAuxiliaryBarWidth(width: number): void {
    const next = Math.max(LAYOUT_MIN.auxiliaryBarWidth, Math.round(width));
    if (next === this.auxiliaryBarWidth) return;
    this.auxiliaryBarWidth = next;
    this.commit();
  }

  togglePanelPosition(): void {
    this.panelPosition =
      this.panelPosition === "bottom" ? "right" : "bottom";
    this.commit();
  }

  movePanelToBottom(): void {
    if (this.panelPosition === "bottom") return;
    this.panelPosition = "bottom";
    this.commit();
  }

  movePanelToRight(): void {
    if (this.panelPosition === "right") return;
    this.panelPosition = "right";
    this.commit();
  }

  togglePanelMaximized(): void {
    if (!this.panelVisible) {
      this.panelVisible = true;
    }

    if (this.panelMaximized) {
      this.panelMaximized = false;
      if (this.panelSizeBeforeMaximize !== null) {
        this.panelSize = this.panelSizeBeforeMaximize;
        this.panelSizeBeforeMaximize = null;
      }
    } else {
      this.panelSizeBeforeMaximize = this.panelSize;
      this.panelMaximized = true;
    }
    this.commit();
  }

  onDidChange(listener: LayoutChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private restoreFromStorage(): void {
    const stored = loadLayoutState();
    if (!stored) return;

    if (typeof stored.sidebar === "boolean") {
      this.sidebarVisible = stored.sidebar;
    }
    if (typeof stored.panel === "boolean") {
      this.panelVisible = stored.panel;
    }
    if (typeof stored.auxiliaryBar === "boolean") {
      this.auxiliaryBarVisible = stored.auxiliaryBar;
    }
    if (typeof stored.sidebarWidth === "number") {
      this.sidebarWidth = Math.max(
        LAYOUT_MIN.sidebarWidth,
        stored.sidebarWidth,
      );
    }
    if (typeof stored.panelSize === "number") {
      this.panelSize = stored.panelSize;
    }
    if (typeof stored.auxiliaryBarWidth === "number") {
      this.auxiliaryBarWidth = Math.max(
        LAYOUT_MIN.auxiliaryBarWidth,
        stored.auxiliaryBarWidth,
      );
    }
    if (stored.panelPosition === "bottom" || stored.panelPosition === "right") {
      this.panelPosition = stored.panelPosition;
    }
    if (typeof stored.panelMaximized === "boolean") {
      this.panelMaximized = stored.panelMaximized;
    }

    const minPanel =
      this.panelPosition === "bottom"
        ? LAYOUT_MIN.panelSizeBottom
        : LAYOUT_MIN.panelSizeRight;
    this.panelSize = Math.max(minPanel, this.panelSize);
  }

  private commit(): void {
    this.updateContextKeys();
    saveLayoutState(this.getState());
    this.fireDidChange();
  }

  private updateContextKeys(): void {
    ContextKeyService.set("sideBarVisible", this.sidebarVisible);
    ContextKeyService.set("panelVisible", this.panelVisible);
    ContextKeyService.set("auxiliaryBarVisible", this.auxiliaryBarVisible);
    ContextKeyService.set("panelMaximized", this.panelMaximized);
    ContextKeyService.set(
      "panelPositionBottom",
      this.panelPosition === "bottom",
    );
    ContextKeyService.set(
      "panelPositionRight",
      this.panelPosition === "right",
    );
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const LayoutService = new LayoutServiceImpl();
