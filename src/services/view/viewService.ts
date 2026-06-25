import { LayoutService } from "../layout/layoutService";

export type ActivityViewId = "explorer" | "search" | "scm";

type ViewChangeListener = () => void;

class ViewServiceImpl {
  private activeViewId: ActivityViewId = "explorer";
  private readonly listeners = new Set<ViewChangeListener>();

  getActiveViewId(): ActivityViewId {
    return this.activeViewId;
  }

  openView(viewId: ActivityViewId): void {
    const isSameView = this.activeViewId === viewId;
    const sidebarVisible = LayoutService.isSidebarVisible();

    if (isSameView && sidebarVisible) {
      LayoutService.hideSidebar();
      this.fireDidChange();
      return;
    }

    this.activeViewId = viewId;
    LayoutService.showSidebar();
    this.fireDidChange();
  }

  onDidChange(listener: ViewChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ViewService = new ViewServiceImpl();
