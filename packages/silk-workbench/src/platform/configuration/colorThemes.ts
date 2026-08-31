import type { ColorThemeId } from "./configurationDefaults";

/**
 * Single source of truth for the theme list — both the Settings > Appearance dropdown
 * (SettingsEditor.tsx) and the gear menu's Themes submenu (activityBar.contribution.ts)
 * render from this instead of keeping their own copies in sync by hand.
 */
export type ColorThemeOption = {
  id: ColorThemeId;
  label: string;
};

export const COLOR_THEMES: readonly ColorThemeOption[] = [
  { id: "dark", label: "Dark" },
  // No light-mode CSS variables exist yet (see global.css) — this only wires up the
  // selection plumbing (setting, menu item, command) ahead of that work.
  { id: "light", label: "Light" },
];
