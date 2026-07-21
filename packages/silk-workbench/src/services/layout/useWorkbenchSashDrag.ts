import { useCallback } from "react";
import type { WorkbenchSashOrientation } from "../../components/layout/WorkbenchSash/WorkbenchSash";

type DragOptions = {
  orientation: WorkbenchSashOrientation;
  onResize: (clientPosition: number) => void;
};

export function useWorkbenchSashDrag() {
  const startDrag = useCallback(({ orientation, onResize }: DragOptions) => {
    const cursorClass =
      orientation === "horizontal"
        ? "workbench-sash-resizing--horizontal"
        : "workbench-sash-resizing--vertical";

    function handlePointerMove(event: PointerEvent) {
      event.preventDefault();
      const current =
        orientation === "horizontal" ? event.clientY : event.clientX;
      onResize(current);
    }

    function handlePointerUp() {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.documentElement.classList.remove(cursorClass);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.documentElement.classList.add(cursorClass);
  }, []);

  return { startDrag };
}
