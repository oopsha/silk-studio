/**
 * Pointer-based Connections explorer profile-row reordering. Same pointer-event approach as
 * `explorerObjectDrag.ts` (not HTML5 DnD) so it doesn't fight Tauri's native OS file-drop on
 * Windows WebView2 — see that module's doc comment for why.
 */

export type ProfileDropPosition = "before" | "after";

type ActiveDrag = {
  profileId: string;
  label: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  ghost: HTMLDivElement | null;
  hoverRow: Element | null;
  hoverPosition: ProfileDropPosition | null;
  onDrop: (targetProfileId: string, position: ProfileDropPosition) => void;
};

const DRAG_THRESHOLD_PX = 4;
/** Drop target marker on each profile row (see ConnectionsExplorer's `ProfileTree`). */
export const SILK_PROFILE_ROW_ATTR = "data-silk-profile-row";
const DROP_BEFORE_CLASS = "connections-explorer__row--drop-before";
const DROP_AFTER_CLASS = "connections-explorer__row--drop-after";

let activeDrag: ActiveDrag | null = null;
let listenersAttached = false;
/** Sticky until the next click-check after a drag gesture. */
let suppressNextClick = false;

function ensureGhost(label: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "silk-explorer-drag-ghost";
  el.textContent = label;
  el.setAttribute("aria-hidden", "true");
  el.style.pointerEvents = "none";
  document.body.appendChild(el);
  return el;
}

function positionGhost(ghost: HTMLDivElement, x: number, y: number): void {
  ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
}

function removeGhost(ghost: HTMLDivElement | null): void {
  ghost?.remove();
}

function clearHoverMark(drag: ActiveDrag): void {
  drag.hoverRow?.classList.remove(DROP_BEFORE_CLASS, DROP_AFTER_CLASS);
  drag.hoverRow = null;
  drag.hoverPosition = null;
}

function clearDrag(): void {
  if (!activeDrag) return;
  clearHoverMark(activeDrag);
  removeGhost(activeDrag.ghost);
  document.documentElement.classList.remove("silk-explorer-dragging");
  activeDrag = null;
}

function resolveDropTarget(
  clientX: number,
  clientY: number,
): { row: Element; profileId: string; position: ProfileDropPosition } | null {
  const el = document.elementFromPoint(clientX, clientY);
  const row = el?.closest(`[${SILK_PROFILE_ROW_ATTR}]`);
  if (!row) return null;
  const profileId = row.getAttribute(SILK_PROFILE_ROW_ATTR);
  if (!profileId) return null;
  const rect = row.getBoundingClientRect();
  const position: ProfileDropPosition =
    clientY < rect.top + rect.height / 2 ? "before" : "after";
  return { row, profileId, position };
}

function onPointerMove(event: PointerEvent): void {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;

  const dx = event.clientX - activeDrag.startX;
  const dy = event.clientY - activeDrag.startY;
  if (
    !activeDrag.active &&
    dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
  ) {
    activeDrag.active = true;
    suppressNextClick = true;
    document.documentElement.classList.add("silk-explorer-dragging");
    activeDrag.ghost = ensureGhost(activeDrag.label);
  }

  if (!activeDrag.active || !activeDrag.ghost) return;
  event.preventDefault();
  positionGhost(activeDrag.ghost, event.clientX, event.clientY);

  const drag = activeDrag;
  const target = resolveDropTarget(event.clientX, event.clientY);
  if (!target || target.profileId === drag.profileId) {
    clearHoverMark(drag);
    return;
  }
  if (target.row !== drag.hoverRow || target.position !== drag.hoverPosition) {
    clearHoverMark(drag);
    drag.hoverRow = target.row;
    drag.hoverPosition = target.position;
    target.row.classList.add(
      target.position === "before" ? DROP_BEFORE_CLASS : DROP_AFTER_CLASS,
    );
  }
}

function onPointerUp(event: PointerEvent): void {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;

  const drag = activeDrag;
  const target = drag.active
    ? resolveDropTarget(event.clientX, event.clientY)
    : null;

  clearDrag();
  detachListeners();

  if (target && target.profileId !== drag.profileId) {
    drag.onDrop(target.profileId, target.position);
  }
}

function onPointerCancel(event: PointerEvent): void {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
  clearDrag();
  detachListeners();
}

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
}

function detachListeners(): void {
  if (!listenersAttached) return;
  listenersAttached = false;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerCancel);
}

/**
 * Begin tracking a potential profile-row drag. Call from `pointerdown` on a profile row's drag
 * handle (primary button only). `onDrop` fires once, only on a successful drop over a different
 * profile row.
 */
export function beginProfileReorderDrag(input: {
  profileId: string;
  label: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  onDrop: (targetProfileId: string, position: ProfileDropPosition) => void;
}): void {
  clearDrag();
  activeDrag = {
    profileId: input.profileId,
    label: input.label,
    pointerId: input.pointerId,
    startX: input.clientX,
    startY: input.clientY,
    active: false,
    ghost: null,
    hoverRow: null,
    hoverPosition: null,
    onDrop: input.onDrop,
  };
  attachListeners();
}

/** True when the last pointer interaction should not fire a click (consumes flag). */
export function shouldSuppressProfileReorderClick(): boolean {
  if (!suppressNextClick) return false;
  suppressNextClick = false;
  return true;
}
