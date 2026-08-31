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
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];
