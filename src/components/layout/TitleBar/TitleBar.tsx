import { useEffect, useState, type MouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Menubar from "../../menubar";
import WindowAppIcon from "./WindowAppIcon";
import "./TitleBar.css";
import "./WindowAppIcon.css";

function detectWco(): boolean {
  return (
    document.documentElement.dataset.wco === "true" ||
    document.getElementById("tbo-controls") !== null
  );
}

function useWco(): boolean {
  const [enabled, setEnabled] = useState(detectWco);

  useEffect(() => {
    if (detectWco()) {
      setEnabled(true);
      return;
    }

    const observer = new MutationObserver(() => {
      if (detectWco()) {
        setEnabled(true);
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-wco"],
    });
    observer.observe(document.body, { childList: true, subtree: false });

    return () => observer.disconnect();
  }, []);

  return enabled;
}

function TitleBar() {
  const wco = useWco();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!wco) return;

    const styleId = "silk-wco-inactive-glyphs";
    const css =
      '#tbo-controls[data-active="false"] .tbo-btn:not(:hover):not(.tbo-hover) .tbo-glyph{opacity:1!important;}';

    function applyOverride() {
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement("style");
        style.id = styleId;
        document.head.appendChild(style);
      }
      style.textContent = css;
    }

    applyOverride();

    const observer = new MutationObserver(applyOverride);
    observer.observe(document.head, { childList: true });

    return () => observer.disconnect();
  }, [wco]);

  async function handleDragRegionMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (!isTauri() || event.button !== 0) return;
    event.preventDefault();

    const window = getCurrentWindow();

    if (event.detail === 2) {
      await window.toggleMaximize();
      return;
    }

    await window.startDragging();
  }

  return (
    <header className={`title-bar${wco ? " title-bar--wco" : ""}`}>
      <div
        className={`title-bar__drag-region${menuOpen ? " title-bar__drag-region--hidden" : ""}`}
        onMouseDown={handleDragRegionMouseDown}
      />

      <div className="title-bar__left">
        <WindowAppIcon />
        <Menubar onMenuOpenChange={setMenuOpen} />
      </div>

      <div className="title-bar__center">silk-editor</div>

      {wco ? <div className="title-bar__right" aria-hidden /> : null}
    </header>
  );
}

export default TitleBar;
