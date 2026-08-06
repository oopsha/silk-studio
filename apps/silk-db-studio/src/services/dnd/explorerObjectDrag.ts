/**
 * Pointer-based Connections explorer → SQL editor drag session.
 * Avoids HTML5 DnD so it works alongside Tauri native OS file-drop
 * (dragDropEnabled / onDragDropEvent) on Windows WebView2.
 */

export type SilkExplorerObjectDragPayload = {
  schemaName: string;
  objectName: string;
  kind?: string;
  profileId?: string;
};

export function encodeExplorerObjectDrag(
  payload: SilkExplorerObjectDragPayload,
): string {
  return JSON.stringify(payload);
}

export function decodeExplorerObjectDrag(
  raw: string,
): SilkExplorerObjectDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SilkExplorerObjectDragPayload>;
    const schemaName = parsed.schemaName?.trim();
    const objectName = parsed.objectName?.trim();
    if (!schemaName || !objectName) return null;
    return {
      schemaName,
      objectName,
      kind: parsed.kind,
      profileId: parsed.profileId,
    };
  } catch {
    return null;
  }
}

type ActiveDrag = {
  payload: SilkExplorerObjectDragPayload;
  label: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  suppressClick: boolean;
  ghost: HTMLDivElement | null;
};

const DRAG_THRESHOLD_PX = 4;
/** Drop target marker on the editor column (see AppShell). */
export const SILK_EDITOR_DROP_ATTR = "data-silk-editor-drop";

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

function clearDrag(): void {
  if (!activeDrag) return;
  removeGhost(activeDrag.ghost);
  document.documentElement.classList.remove("silk-explorer-dragging");
  activeDrag = null;
}

function isOverEditorDropTarget(clientX: number, clientY: number): boolean {
  const el = document.elementFromPoint(clientX, clientY);
  return Boolean(el?.closest(`[${SILK_EDITOR_DROP_ATTR}]`));
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
    activeDrag.suppressClick = true;
    suppressNextClick = true;
    document.documentElement.classList.add("silk-explorer-dragging");
    activeDrag.ghost = ensureGhost(activeDrag.label);
  }

  if (!activeDrag.active || !activeDrag.ghost) return;
  event.preventDefault();
  positionGhost(activeDrag.ghost, event.clientX, event.clientY);
}

function onPointerUp(event: PointerEvent): void {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;

  const drag = activeDrag;
  const dropped =
    drag.active && isOverEditorDropTarget(event.clientX, event.clientY)
      ? drag.payload
      : null;

  clearDrag();
  detachListeners();

  if (dropped) {
    const { onExplorerObjectDrop } = dragCallbacks;
    onExplorerObjectDrop?.(dropped);
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

type DragCallbacks = {
  onExplorerObjectDrop?: (payload: SilkExplorerObjectDragPayload) => void;
};

const dragCallbacks: DragCallbacks = {};

/** Register how a completed explorer→editor drop should insert SQL. */
export function setExplorerObjectDropHandler(
  handler: ((payload: SilkExplorerObjectDragPayload) => void) | null,
): void {
  dragCallbacks.onExplorerObjectDrop = handler ?? undefined;
}

/**
 * Begin tracking a potential object drag from the explorer tree.
 * Call from `pointerdown` on an object row (primary button only).
 */
export function beginExplorerObjectPointerDrag(input: {
  payload: SilkExplorerObjectDragPayload;
  label: string;
  pointerId: number;
  clientX: number;
  clientY: number;
}): void {
  clearDrag();
  activeDrag = {
    payload: input.payload,
    label: input.label,
    pointerId: input.pointerId,
    startX: input.clientX,
    startY: input.clientY,
    active: false,
    suppressClick: false,
    ghost: null,
  };
  attachListeners();
}

/** True when the last pointer interaction should not fire a click (consumes flag). */
export function shouldSuppressExplorerObjectClick(): boolean {
  if (!suppressNextClick) return false;
  suppressNextClick = false;
  return true;
}

export function peekExplorerObjectDrag(): SilkExplorerObjectDragPayload | null {
  return activeDrag?.active ? activeDrag.payload : null;
}
