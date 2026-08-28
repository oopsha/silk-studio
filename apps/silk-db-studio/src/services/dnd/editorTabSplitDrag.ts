/**
 * Drag-a-tab-to-split — same pointer-event approach as the rest of this app's DnD (not HTML5,
 * for Tauri/WebView2 coexistence; see explorerObjectDrag.ts's doc comment). Reuses the same
 * `data-silk-editor-drop`/`-group` markers `EditorGroupsView` already puts on every pane for the
 * schema-object-drag feature — a tab drag just resolves against the same targets.
 *
 * Zone layout mirrors VS Code's `editorDropTarget.ts`: the center ~80% of a pane is "merge"
 * (add the tab there), the outer 10% edge band plus the surrounding thirds pick a split
 * direction — top/bottom are full-width bands, the vertical middle third splits left/right.
 */
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import type {
  EditorGroupId,
  SplitDirection,
} from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import {
  SILK_EDITOR_DROP_ATTR,
  SILK_EDITOR_DROP_GROUP_ATTR,
} from "./explorerObjectDrag";

export type TabDropZone = "center" | "up" | "down" | "left" | "right";

const EDGE_THRESHOLD_RATIO = 0.1;
const OVERLAY_CLASS = "silk-editor-split-drop-overlay";

type ResolvedTarget = {
  element: Element;
  groupId: EditorGroupId;
  zone: TabDropZone;
  /** Pixel height of the pane's own tab strip, if any — the overlay is drawn only in the area
   * below it (see positionOverlay), matching the zone math which excludes it too. */
  tabBarHeight: number;
};

/**
 * `withinTabStrip` is true whenever the pointer is over the pane's own tab strip — hovering
 * there is always "add this tab to that group", never a split, no matter how close to the top
 * edge it is (matches VS Code: the split-zone overlay only covers the area *below* the tab
 * strip). Without this, the tab strip sitting right at a pane's top edge would otherwise fall
 * inside the "up" split zone purely by geometry.
 */
function resolveZone(
  pane: Element,
  paneRect: DOMRect,
  clientX: number,
  clientY: number,
): { zone: TabDropZone; withinTabStrip: boolean; tabBarHeight: number } {
  const tabBar = pane.querySelector(".tab-bar");
  const contentTop = tabBar ? tabBar.getBoundingClientRect().bottom : paneRect.top;
  const tabBarHeight = Math.max(0, contentTop - paneRect.top);
  if (clientY <= contentTop) {
    return { zone: "center", withinTabStrip: true, tabBarHeight };
  }

  const x = clientX - paneRect.left;
  const y = clientY - contentTop;
  const width = paneRect.width;
  const height = paneRect.bottom - contentTop;
  if (height <= 0) return { zone: "center", withinTabStrip: false, tabBarHeight };

  const edgeX = width * EDGE_THRESHOLD_RATIO;
  const edgeY = height * EDGE_THRESHOLD_RATIO;
  const insideCenter = x > edgeX && x < width - edgeX && y > edgeY && y < height - edgeY;
  if (insideCenter) return { zone: "center", withinTabStrip: false, tabBarHeight };

  const thirdHeight = height / 3;
  if (y < thirdHeight) return { zone: "up", withinTabStrip: false, tabBarHeight };
  if (y > thirdHeight * 2) return { zone: "down", withinTabStrip: false, tabBarHeight };
  return {
    zone: x < width / 2 ? "left" : "right",
    withinTabStrip: false,
    tabBarHeight,
  };
}

function resolveTarget(
  clientX: number,
  clientY: number,
  sourceGroupId: EditorGroupId,
): ResolvedTarget | null {
  const el = document.elementFromPoint(clientX, clientY);
  const pane = el?.closest(`[${SILK_EDITOR_DROP_ATTR}]`);
  if (!pane) return null;
  const groupId = pane.getAttribute(SILK_EDITOR_DROP_GROUP_ATTR);
  if (!groupId) return null;

  const rect = pane.getBoundingClientRect();
  const { zone, withinTabStrip, tabBarHeight } = resolveZone(pane, rect, clientX, clientY);
  // Hovering the tab's own tab strip is a no-op here — that's the tab bar's own
  // same-tabbar reorder gesture, unrelated to cross-pane split/merge.
  if (groupId === sourceGroupId && withinTabStrip) return null;
  return { element: pane, groupId, zone, tabBarHeight };
}

/** Fractional (0–1) rect within the *content area* (below the tab strip) for each zone. */
const ZONE_FRACTIONS: Record<
  TabDropZone,
  { top: number; left: number; width: number; height: number }
> = {
  center: { top: 0, left: 0, width: 1, height: 1 },
  up: { top: 0, left: 0, width: 1, height: 0.5 },
  down: { top: 0.5, left: 0, width: 1, height: 0.5 },
  left: { top: 0, left: 0, width: 0.5, height: 1 },
  right: { top: 0, left: 0.5, width: 0.5, height: 1 },
};

let overlayEl: HTMLDivElement | null = null;
let overlayParent: Element | null = null;
let lastResolved: ResolvedTarget | null = null;

function positionOverlay(parent: Element, zone: TabDropZone, tabBarHeight: number): void {
  if (!overlayEl || overlayParent !== parent) {
    removeOverlay();
    overlayEl = document.createElement("div");
    overlayEl.className = OVERLAY_CLASS;
    parent.appendChild(overlayEl);
    overlayParent = parent;
  }
  // Never shade the tab strip itself — only the content area below it, same as the zone math.
  const f = ZONE_FRACTIONS[zone];
  overlayEl.style.top = `calc(${tabBarHeight}px + (100% - ${tabBarHeight}px) * ${f.top})`;
  overlayEl.style.height = `calc((100% - ${tabBarHeight}px) * ${f.height})`;
  overlayEl.style.left = `${f.left * 100}%`;
  overlayEl.style.width = `${f.width * 100}%`;
}

function removeOverlay(): void {
  overlayEl?.remove();
  overlayEl = null;
  overlayParent = null;
}

/**
 * Call on every `pointermove` while dragging a tab. Returns true when a foreign-pane drop zone
 * is active (caller should suppress its own same-tabbar drop indicator while this is true).
 */
export function updateEditorTabSplitHover(
  clientX: number,
  clientY: number,
  sourceGroupId: EditorGroupId,
): boolean {
  const resolved = resolveTarget(clientX, clientY, sourceGroupId);
  lastResolved = resolved;
  if (!resolved) {
    removeOverlay();
    return false;
  }
  positionOverlay(resolved.element, resolved.zone, resolved.tabBarHeight);
  return true;
}

/**
 * Call on `pointerup` to commit whatever zone was last hovered. Returns true if it consumed the
 * drop (a foreign-pane target was active) — the caller should skip its own same-tabbar commit.
 */
export function commitEditorTabSplitDrop(
  tabId: string,
  sourceGroupId: EditorGroupId,
): boolean {
  const resolved = lastResolved;
  cancelEditorTabSplitDrag();
  if (!resolved) return false;

  if (resolved.zone === "center") {
    EditorGroupsService.moveTabToGroup(tabId, sourceGroupId, resolved.groupId);
  } else {
    const direction: SplitDirection =
      resolved.zone === "left" || resolved.zone === "right" ? "row" : "column";
    const position: "before" | "after" =
      resolved.zone === "left" || resolved.zone === "up" ? "before" : "after";
    EditorGroupsService.moveTabToNewSplit(
      tabId,
      sourceGroupId,
      resolved.groupId,
      direction,
      position,
    );
  }
  return true;
}

/** Call on drag cancel/end to clean up the overlay without committing anything. */
export function cancelEditorTabSplitDrag(): void {
  removeOverlay();
  lastResolved = null;
}
