import { useEffect, useState, type MouseEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { detectWorkbenchPlatform } from "@silk-studio/ui/platform/fonts.ts";
import Menubar from "../../menubar";
import WindowAppIcon from "./WindowAppIcon";
import CommandCenter from "./CommandCenter";
import LayoutControls from "./LayoutControls";
import {
  OpenEditorsQuickPickProvider,
  OpenEditorsQuickPick,
} from "./OpenEditorsQuickPick";
import "./TitleBar.css";
import "./WindowAppIcon.css";

function detectWco(): boolean {
  if (detectWorkbenchPlatform() !== "windows") {
    return false;
  }

  return (
    document.documentElement.dataset.wco === "true" ||
    document.getElementById("tbo-controls") !== null
  );
}

function useWco(): boolean {
  const [enabled, setEnabled] = useState(detectWco);

  useEffect(() => {
    if (!isTauri() || detectWorkbenchPlatform() !== "windows") return;

    let disposed = false;

    async function ensureWco() {
      if (document.getElementById("tbo-controls")) {
        if (!disposed) setEnabled(true);
        return;
      }

      try {
        await invoke("ensure_title_bar_overlay");
        if (!disposed) setEnabled(true);
      } catch (error) {
        console.warn("[titlebar] failed to initialize window controls", error);
      }
    }

    void ensureWco();

    const observer = new MutationObserver(() => {
      if (!document.getElementById("tbo-controls")) {
        void ensureWco();
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-wco"],
    });
    observer.observe(document.body, { childList: true });

    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, []);

  return enabled;
}

function TitleBar() {
  const platform = detectWorkbenchPlatform();
  const isMacOverlay = platform === "mac" && isTauri();
  const wco = useWco();
  const [macFullscreen, setMacFullscreen] = useState(false);
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

  useEffect(() => {
    if (!isTauri()) return;
    void getCurrentWindow().setBackgroundColor("#191a1b");
  }, []);

  useEffect(() => {
    if (!isMacOverlay) return;

    let disposed = false;
    const window = getCurrentWindow();

    async function syncFullscreenState() {
      try {
        const fullscreen = await window.isFullscreen();
        if (!disposed) setMacFullscreen(fullscreen);
      } catch (error) {
        console.warn("[titlebar] failed to read fullscreen state", error);
      }
    }

    void syncFullscreenState();

    const unlistenPromise = window.onResized(() => {
      void syncFullscreenState();
    });

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isMacOverlay]);

  async function handleDragRegionMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (!isTauri() || event.button !== 0) return;

    if (event.detail === 2) {
      event.preventDefault();
      await getCurrentWindow().toggleMaximize();
    }
  }

  async function handleMacClose() {
    if (!isTauri()) return;
    await getCurrentWindow().close();
  }

  async function handleMacMinimize() {
    if (!isTauri()) return;
    await getCurrentWindow().minimize();
  }

  async function handleMacZoom() {
    if (!isTauri()) return;

    const window = getCurrentWindow();
    const fullscreen = await window.isFullscreen();
    if (fullscreen) {
      await window.setFullscreen(false);
      return;
    }
    await window.toggleMaximize();
  }

  return (
    <header
      className={`title-bar title-bar--has-center${wco ? " title-bar--wco" : ""}${isMacOverlay ? " title-bar--mac-overlay" : ""}`}
    >
      <div
        className={`title-bar__drag-region${menuOpen ? " title-bar__drag-region--hidden" : ""}`}
        data-tauri-drag-region
        onMouseDown={handleDragRegionMouseDown}
      />

      <div className="title-bar__left">
        {isMacOverlay ? (
          macFullscreen ? (
            <div className="title-bar__mac-controls" role="group" aria-label="Window controls">
              <button
                type="button"
                className="title-bar__mac-control title-bar__mac-control--close"
                aria-label="Close window"
                onClick={() => void handleMacClose()}
              />
              <button
                type="button"
                className="title-bar__mac-control title-bar__mac-control--minimize"
                aria-label="Minimize window"
                onClick={() => void handleMacMinimize()}
              />
              <button
                type="button"
                className="title-bar__mac-control title-bar__mac-control--zoom"
                aria-label="Zoom window"
                onClick={() => void handleMacZoom()}
              />
            </div>
          ) : (
            <div className="title-bar__traffic-lights-spacer" aria-hidden />
          )
        ) : (
          <WindowAppIcon />
        )}
        <Menubar
          onMenuOpenChange={setMenuOpen}
          onDragRegionMouseDown={handleDragRegionMouseDown}
        />
      </div>

      <div className="title-bar__center">
        <OpenEditorsQuickPickProvider>
          <CommandCenter />
          <OpenEditorsQuickPick />
        </OpenEditorsQuickPickProvider>
      </div>

      <div className="title-bar__right">
        <div
          className="title-bar__gap"
          data-tauri-drag-region
          onMouseDown={handleDragRegionMouseDown}
        />
        <LayoutControls />
        {wco ? <div className="title-bar__wco-spacer" aria-hidden /> : null}
      </div>
    </header>
  );
}

export default TitleBar;
