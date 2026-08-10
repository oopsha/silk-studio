import { useRef } from "react";
import type { MouseEvent } from "react";

/**
 * Click-outside-to-close for a full-screen modal backdrop, safe for
 * text-selection drags. A native `click` event's target is resolved from the
 * *mouseup* position, not mousedown — so dragging a selection from inside the
 * dialog out past its edges (or releasing the mouse button outside the
 * window) can land the click on the backdrop even though the gesture started
 * on real content, closing the dialog mid-drag. This only closes when both
 * mousedown and click landed on the backdrop element itself.
 */
export function useBackdropDismiss(onDismiss: () => void, enabled = true) {
  const downOnBackdrop = useRef(false);

  return {
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      downOnBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      const wasDown = downOnBackdrop.current;
      downOnBackdrop.current = false;
      if (enabled && wasDown && event.target === event.currentTarget) {
        onDismiss();
      }
    },
  };
}
