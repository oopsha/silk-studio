export type ColorThemeId = "dark" | "light" | "system";
export type EffectiveColorThemeId = "dark" | "light";

/** Silk's fallback when the OS reports neither a dark nor a light preference (rare — most
 *  platforms report one or the other, but a bare/unset `prefers-color-scheme` is possible). */
const DEFAULT_EFFECTIVE_THEME: EffectiveColorThemeId = "dark";

/** Resolves "system" to the OS's actual light/dark preference; "dark"/"light" pass through. */
export function resolveEffectiveColorTheme(theme: ColorThemeId): EffectiveColorThemeId {
  if (theme !== "system") return theme;
  if (typeof window === "undefined" || !window.matchMedia) {
    return DEFAULT_EFFECTIVE_THEME;
  }
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return DEFAULT_EFFECTIVE_THEME;
}

/**
 * Subscribes to OS light/dark preference changes. Fires on every OS-level flip regardless of
 * whether "system" is the currently active `workbench.colorTheme` — callers that only care while
 * "system" is selected should check that themselves before reacting.
 */
export function onSystemColorSchemeChange(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", listener);
  return () => mql.removeEventListener("change", listener);
}
