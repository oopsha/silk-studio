import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useCloseOnAppBlur(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function close() {
      onClose();
    }

    window.addEventListener("blur", close);

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    if (isTauri()) {
      void getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => {
          if (!focused) {
            close();
          }
        })
        .then((fn) => {
          if (cancelled) {
            fn();
            return;
          }
          unlisten = fn;
        });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("blur", close);
      unlisten?.();
    };
  }, [onClose, enabled]);
}
