/** Shared title-bar Quick Pick placement (Open Editors / connection / object search). */

export const TITLEBAR_QUICK_PICK_CLASS = "titlebar-quick-pick-active";

export function getSilkEditorAnchor(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>("[data-command-center-anchor]") ??
    document.querySelector<HTMLElement>(".command-center__center") ??
    document.querySelector<HTMLElement>("[data-open-editors-anchor]")
  );
}

/** Place the picker exactly over the silk-editor command-center control. */
export function placeOverSilkEditor(el: HTMLElement): boolean {
  const anchor = getSilkEditorAnchor();
  if (!anchor) return false;
  const rect = anchor.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  el.style.setProperty("position", "fixed", "important");
  el.style.setProperty(
    "top",
    `${Math.max(0, Math.round(rect.top) - 6)}px`,
    "important",
  );
  el.style.setProperty("left", `${Math.round(rect.left)}px`, "important");
  el.style.setProperty("width", `${Math.round(rect.width)}px`, "important");
  el.style.setProperty("right", "auto", "important");
  el.style.setProperty("bottom", "auto", "important");
  el.style.setProperty("transform", "none", "important");
  el.style.setProperty("margin", "0", "important");
  el.style.setProperty("visibility", "visible", "important");
  el.style.setProperty("opacity", "1", "important");
  el.style.setProperty("z-index", "6000", "important");
  return true;
}
