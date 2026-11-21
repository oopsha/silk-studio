import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import "./useMarqueeSelection.css";

type MarqueeOptions = {
  /** Id of the item at `index` among the elements matched by `itemSelector`. */
  idAt: (index: number) => string | undefined;
  /** Ids selected now (the base of a Ctrl/Cmd/Shift drag). */
  selected: ReadonlySet<string>;
  onSelect: (ids: Set<string>) => void;
  /** Items carry their index in `data-index`. */
  itemSelector?: string;
  /** Rows handle their own selection when false: only presses on empty space start a rectangle. */
  fromItems?: boolean;
};

/**
 * Rubber-band selection for a scrolling list. Spread `onPointerDown` on the scroll container (it must be
 * `position: relative`) and render `overlay` inside it. A press that is dragged beyond a few pixels draws a
 * rectangle and selects the items it touches; a plain click on empty space clears the selection.
 */
export function useMarqueeSelection({ idAt, selected, onSelect, itemSelector = "[data-index]", fromItems = true }: MarqueeOptions) {
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("th, button, a, input, textarea")) return;
    const onItem = target.closest(itemSelector) !== null;
    if (onItem && !fromItems) return;
    const container = event.currentTarget;
    const bounds = container.getBoundingClientRect();
    if (event.clientX >= bounds.left + container.clientWidth || event.clientY >= bounds.top + container.clientHeight) return; // scrollbar
    // No preventDefault: cancelling pointerdown would also suppress mousedown, which popups use to close.
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const base = additive ? new Set(selected) : new Set<string>();
    const startX = event.clientX - bounds.left + container.scrollLeft;
    const startY = event.clientY - bounds.top + container.scrollTop;
    let moved = false;
    const move = (e: PointerEvent) => {
      const r = container.getBoundingClientRect();
      const x = e.clientX - r.left + container.scrollLeft;
      const y = e.clientY - r.top + container.scrollTop;
      if (!moved && Math.abs(x - startX) < 4 && Math.abs(y - startY) < 4) return;
      if (!moved) container.setPointerCapture(event.pointerId); // a plain click on an item must still reach it
      moved = true;
      const left = Math.min(x, startX), top = Math.min(y, startY), w = Math.abs(x - startX), h = Math.abs(y - startY);
      setRect({ x: left, y: top, w, h });
      const ids = new Set(base);
      container.querySelectorAll<HTMLElement>(itemSelector).forEach((element) => {
        const b = element.getBoundingClientRect();
        const ex = b.left - r.left + container.scrollLeft, ey = b.top - r.top + container.scrollTop;
        if (ex < left + w && ex + b.width > left && ey < top + h && ey + b.height > top) {
          const id = idAt(Number(element.dataset.index));
          if (id !== undefined) ids.add(id);
        }
      });
      onSelect(ids);
    };
    const end = () => {
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerup", end);
      container.removeEventListener("pointercancel", end);
      setRect(null);
      if (moved) {
        // The click that ends a drag must not reselect the item under the pointer.
        const swallow = (e: Event) => e.stopPropagation();
        container.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => container.removeEventListener("click", swallow, true), 0);
      } else if (!onItem && !additive) onSelect(new Set());
    };
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerup", end);
    container.addEventListener("pointercancel", end);
  };

  const overlay: ReactNode = rect ? <div className="workbench-marquee" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} /> : null;
  return { onPointerDown, overlay };
}
