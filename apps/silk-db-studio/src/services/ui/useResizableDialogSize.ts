import { useCallback, useRef } from "react";

type StoredSize = { width: number; height: number };

function readStoredSize(storageKey: string): StoredSize | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredSize).width === "number" &&
      typeof (parsed as StoredSize).height === "number"
    ) {
      return parsed as StoredSize;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Makes a modal's root element resizable via the browser's native corner-resize handle
 * (the element must have `resize: both` + `overflow: auto`, and its own fixed `min-width`/
 * `min-height` floor, in CSS) and remembers the user's last chosen size in `localStorage`,
 * restoring it on next open.
 *
 * The floor is a fixed CSS value, not measured from the element at mount time — an earlier
 * version read `element.offsetWidth` to compute it dynamically, which meant the floor could end
 * up wrong depending on exactly when that read happened relative to the DOM/CSS being ready,
 * leaving the dialog stuck unable to shrink back down after being enlarged once. A plain CSS
 * `min-width`/`min-height` always wins over an inline `width`/`height` in the box model, so this
 * hook can just set the stored size unconditionally — even a corrupted or stale stored value
 * smaller than the CSS floor is automatically clamped back up by the cascade, and the floor
 * itself never moves.
 *
 * Returns a *callback ref*, not a ref object — these dialogs stay mounted for the app's whole
 * lifetime and just render `null` while closed, so their root `<div>` unmounts/remounts on every
 * open/close. A plain `useEffect([storageKey])` would only ever run once (on the very first open)
 * and never again for the fresh `<div>` each later open attaches to a ref object. A callback ref
 * re-runs this setup on every single mount, matching the dialog's actual lifecycle.
 */
export function useResizableDialogSize(storageKey: string) {
  const cleanupRef = useRef<() => void>(() => {});

  return useCallback(
    (element: HTMLDivElement | null) => {
      cleanupRef.current();
      cleanupRef.current = () => {};
      if (!element) return;

      const stored = readStoredSize(storageKey);
      if (stored) {
        element.style.width = `${stored.width}px`;
        element.style.height = `${stored.height}px`;
      }

      let frame: number | null = null;
      const observer = new ResizeObserver(() => {
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
          try {
            localStorage.setItem(
              storageKey,
              JSON.stringify({ width: element.offsetWidth, height: element.offsetHeight }),
            );
          } catch {
            // best-effort only — a full storage quota shouldn't break resizing.
          }
        });
      });
      observer.observe(element);

      cleanupRef.current = () => {
        observer.disconnect();
        if (frame !== null) window.cancelAnimationFrame(frame);
      };
    },
    [storageKey],
  );
}
