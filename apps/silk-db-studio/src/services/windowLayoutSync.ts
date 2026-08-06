import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  LayoutService,
  WINDOW_LAYOUT_MIN,
  type WindowLayoutState,
} from "@silk-studio/workbench/services/layout/layoutService.ts";

const PERSIST_DEBOUNCE_MS = 250;
/** Ignore restore/overlay-triggered move/resize noise on startup. */
const STARTUP_SUPPRESS_MS = 600;

async function captureWindowLayout(): Promise<WindowLayoutState | null> {
  try {
    const win = getCurrentWindow();
    const factor = await win.scaleFactor();
    const maximized = await win.isMaximized();
    // set_size applies inner size — capture the same metric to avoid grow-on-restart.
    const size = (await win.innerSize()).toLogical(factor);
    const position = (await win.outerPosition()).toLogical(factor);
    return {
      windowX: position.x,
      windowY: position.y,
      windowWidth: Math.max(WINDOW_LAYOUT_MIN.width, size.width),
      windowHeight: Math.max(WINDOW_LAYOUT_MIN.height, size.height),
      windowMaximized: maximized,
    };
  } catch {
    return null;
  }
}

async function saveWindowLayoutFile(layout: WindowLayoutState): Promise<void> {
  try {
    await invoke("window_layout_save", { layout });
  } catch {
    // Ignore persistence failures; localStorage remains the fallback.
  }
}

async function ensureWindowVisible(): Promise<void> {
  try {
    await invoke("window_layout_show");
  } catch {
    try {
      await getCurrentWindow().show();
    } catch {
      // Already visible or window API unavailable.
    }
  }
}

function resolveLayoutToPersist(layout: WindowLayoutState): WindowLayoutState {
  if (!layout.windowMaximized) {
    return layout;
  }

  const previous = LayoutService.getWindowLayout();
  if (!previous) {
    return layout;
  }

  return {
    windowX: previous.windowX,
    windowY: previous.windowY,
    windowWidth: previous.windowWidth,
    windowHeight: previous.windowHeight,
    windowMaximized: true,
  };
}

async function persistWindowLayout(): Promise<void> {
  const layout = await captureWindowLayout();
  if (!layout) return;

  const toSave = resolveLayoutToPersist(layout);
  LayoutService.setWindowLayout(toSave);
  await saveWindowLayoutFile(toSave);
}

/**
 * Keep OS window geometry in sync with layout storage.
 * Startup geometry is applied in Rust (always show). This module migrates
 * legacy localStorage geometry once and persists user move/resize.
 * Size is stored as inner (client) size to match Tauri `set_size`.
 */
export function startWindowLayoutSync(): () => void {
  if (!isTauri()) {
    return () => undefined;
  }

  let disposed = false;
  let suppressPersistUntil = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const unlisteners: Array<() => void> = [];

  const schedulePersist = () => {
    if (disposed) return;
    if (Date.now() < suppressPersistUntil) return;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (disposed || Date.now() < suppressPersistUntil) return;
      void persistWindowLayout();
    }, PERSIST_DEBOUNCE_MS);
  };

  void (async () => {
    let hasLayoutFile = false;
    try {
      hasLayoutFile = await invoke<boolean>("window_layout_file_exists");
    } catch {
      hasLayoutFile = false;
    }

    // One-shot migration: localStorage → file (Rust clamps + shows).
    if (!hasLayoutFile && !disposed) {
      const stored = LayoutService.getWindowLayout();
      if (stored) {
        try {
          await invoke("window_layout_apply_and_show", { layout: stored });
          hasLayoutFile = true;
        } catch {
          // Fall through to ensureVisible.
        }
      }
    }

    // Safety net: Rust should already have shown; never leave visible:false stuck.
    if (!disposed) {
      await ensureWindowVisible();
    }

    if (disposed) return;

    try {
      const win = getCurrentWindow();
      // Do not persist on startup — restore/overlay already set geometry; capturing
      // here (especially outer vs inner) caused size/position drift every launch.
      suppressPersistUntil = Date.now() + STARTUP_SUPPRESS_MS;
      unlisteners.push(await win.onResized(() => schedulePersist()));
      unlisteners.push(await win.onMoved(() => schedulePersist()));
      unlisteners.push(await win.onScaleChanged(() => schedulePersist()));
    } catch {
      if (!disposed) {
        await ensureWindowVisible();
      }
    }
  })();

  return () => {
    disposed = true;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}
