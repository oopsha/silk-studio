import { ContextKeyService } from "../../platform/context/contextKeyService";

export type LayoutVisibility = {
  sidebar: boolean;
  panel: boolean;
  auxiliaryBar: boolean;
};

type LayoutChangeListener = () => void;

class LayoutServiceImpl {
  private sidebarVisible = true;
  private panelVisible = false;
  private auxiliaryBarVisible = false;
  private readonly listeners = new Set<LayoutChangeListener>();

  constructor() {
    this.updateContextKeys();
  }

  getVisibility(): LayoutVisibility {
    return {
      sidebar: this.sidebarVisible,
      panel: this.panelVisible,
      auxiliaryBar: this.auxiliaryBarVisible,
    };
  }

  toggleSidebar(): void {
    this.sidebarVisible = !this.sidebarVisible;
    this.updateContextKeys();
    this.fireDidChange();
  }

  showSidebar(): void {
    if (this.sidebarVisible) return;
    this.sidebarVisible = true;
    this.updateContextKeys();
    this.fireDidChange();
  }

  hideSidebar(): void {
    if (!this.sidebarVisible) return;
    this.sidebarVisible = false;
    this.updateContextKeys();
    this.fireDidChange();
  }

  isSidebarVisible(): boolean {
    return this.sidebarVisible;
  }

  togglePanel(): void {
    this.panelVisible = !this.panelVisible;
    this.updateContextKeys();
    this.fireDidChange();
  }

  toggleAuxiliaryBar(): void {
    this.auxiliaryBarVisible = !this.auxiliaryBarVisible;
    this.updateContextKeys();
    this.fireDidChange();
  }

  onDidChange(listener: LayoutChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private updateContextKeys(): void {
    ContextKeyService.set("sideBarVisible", this.sidebarVisible);
    ContextKeyService.set("panelVisible", this.panelVisible);
    ContextKeyService.set("auxiliaryBarVisible", this.auxiliaryBarVisible);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const LayoutService = new LayoutServiceImpl();
