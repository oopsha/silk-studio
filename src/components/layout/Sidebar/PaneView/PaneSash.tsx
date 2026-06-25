import { useState, type PointerEvent as ReactPointerEvent } from "react";
import "./PaneSash.css";

type PaneSashProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

function PaneSash({ onPointerDown }: PaneSashProps) {
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
      className={`pane-sash pane-sash--horizontal${active ? " pane-sash--active" : ""}`}
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
    />
  );
}

export default PaneSash;
