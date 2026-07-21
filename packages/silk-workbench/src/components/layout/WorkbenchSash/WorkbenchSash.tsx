import { useState, type PointerEvent as ReactPointerEvent } from "react";
import "./WorkbenchSash.css";

export type WorkbenchSashOrientation = "horizontal" | "vertical";

type WorkbenchSashProps = {
  orientation: WorkbenchSashOrientation;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

function WorkbenchSash({ orientation, onPointerDown }: WorkbenchSashProps) {
  const [active, setActive] = useState(false);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive(true);
    onPointerDown(event);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setActive(false);
  }

  function handleLostPointerCapture() {
    setActive(false);
  }

  return (
    <div
      className={`workbench-sash workbench-sash--${orientation}${
        active ? " workbench-sash--active" : ""
      }`}
      role="separator"
      aria-orientation={orientation}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
    />
  );
}

export default WorkbenchSash;
