import { useCallback, useEffect, useRef, useState } from "react";

const PANE_HEADER_HEIGHT = 22;
const SASH_SIZE = 4;
const MIN_BODY_HEIGHT = 22;

type UseResizablePanesOptions = {
  paneIds: readonly string[];
  defaultBodyHeights?: Record<string, number>;
};

export function useResizablePanes({
  paneIds,
  defaultBodyHeights = {},
}: UseResizablePanesOptions) {
  const [bodyHeights, setBodyHeights] = useState<Record<string, number>>({});
  const dragRef = useRef<{
    topId: string;
    startY: number;
    startTopBodyHeight: number;
    startBottomBodyHeight: number;
  } | null>(null);

  useEffect(() => {
    setBodyHeights((current) => {
      const next = { ...current };
      let changed = false;

      for (const id of paneIds.slice(0, -1)) {
        if (next[id] === undefined) {
          next[id] = defaultBodyHeights[id] ?? 120;
          changed = true;
        }
      }

      for (const id of Object.keys(next)) {
        if (!paneIds.includes(id)) {
          delete next[id];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [paneIds, defaultBodyHeights]);

  const getBodyHeight = useCallback(
    (id: string) => bodyHeights[id] ?? defaultBodyHeights[id] ?? 120,
    [bodyHeights, defaultBodyHeights],
  );

  const startResize = useCallback(
    (
      topId: string,
      bottomId: string,
      bottomIsFlex: boolean,
      clientY: number,
    ) => {
      dragRef.current = {
        topId,
        startY: clientY,
        startTopBodyHeight: getBodyHeight(topId),
        startBottomBodyHeight: getBodyHeight(bottomId),
      };

      function handlePointerMove(event: PointerEvent) {
        const drag = dragRef.current;
        if (!drag) return;

        event.preventDefault();
        const delta = event.clientY - drag.startY;

        if (bottomIsFlex) {
          setBodyHeights((current) => ({
            ...current,
            [topId]: Math.max(MIN_BODY_HEIGHT, drag.startTopBodyHeight + delta),
          }));
          return;
        }

        setBodyHeights((current) => ({
          ...current,
          [topId]: Math.max(MIN_BODY_HEIGHT, drag.startTopBodyHeight + delta),
          [bottomId]: Math.max(
            MIN_BODY_HEIGHT,
            drag.startBottomBodyHeight - delta,
          ),
        }));
      }

      function handlePointerUp() {
        dragRef.current = null;
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
        document.documentElement.classList.remove("pane-sash-resizing");
      }

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
      document.documentElement.classList.add("pane-sash-resizing");
    },
    [getBodyHeight],
  );

  return {
    getBodyHeight,
    startResize,
    paneHeaderHeight: PANE_HEADER_HEIGHT,
    sashSize: SASH_SIZE,
    minBodyHeight: MIN_BODY_HEIGHT,
  };
}
