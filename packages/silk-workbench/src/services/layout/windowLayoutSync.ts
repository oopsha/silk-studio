import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  LayoutService,
  WINDOW_LAYOUT_MIN,
  type WindowLayoutState,
} from "./layoutService";

const PERSIST_DEBOUNCE_MS = 250;
/** Ignore restore/overlay-triggered move/resize noise on startup. */
const STARTUP_SUPPRESS_MS = 600;

async function captureWindowLayout(): Promise<WindowLayoutState | null> {
  try {
    const win = getCurrentWindow();
    const factor = await win.scaleFactor();
    const maximized = await win.isMaximized();
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
  if (!layout.windowMaximized) return layout;

  const previous = LayoutService.getWindowLayout();
  if (!previous) return layout;

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
 * Keep OS window geometry in sync with layout storage. Rust restores the saved
 * geometry at startup; this service migrates legacy localStorage state once and
 * persists subsequent move/resize events.
 */
export function startWindowLayoutSync(): () => void {
  if (!isTauri()) return () => undefined;

  let disposed = false;
  let suppressPersistUntil = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const unlisteners: Array<() => void> = [];

  const schedulePersist = () => {
    if (disposed || Date.now() < suppressPersistUntil) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!disposed && Date.now() >= suppressPersistUntil) {
        void persistWindowLayout();
      }
    }, PERSIST_DEBOUNCE_MS);
  };

  void (async () => {
    let hasLayoutFile = false;
    try {
      hasLayoutFile = await invoke<boolean>("window_layout_file_exists");
    } catch {
      hasLayoutFile = false;
    }

    // One-shot migration: localStorage → app-specific file (Rust clamps + shows).
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

    if (!disposed) await ensureWindowVisible();
    if (disposed) return;

    try {
      const win = getCurrentWindow();
      suppressPersistUntil = Date.now() + STARTUP_SUPPRESS_MS;
      unlisteners.push(await win.onResized(schedulePersist));
      unlisteners.push(await win.onMoved(schedulePersist));
      unlisteners.push(await win.onScaleChanged(schedulePersist));
    } catch {
      if (!disposed) await ensureWindowVisible();
    }
  })();

  return () => {
    disposed = true;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    for (const unlisten of unlisteners) unlisten();
  };
}
