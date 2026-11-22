import { ContextKeyService } from "../context/contextKeyService";
import { COLOR_THEMES } from "./colorThemes";
import { ConfigurationService } from "./configurationService";

/** Context key that is true while the theme `id` is the selected one; menus use it to check the item. */
export const themeCheckKey = (id: string) => `colorTheme.${id}`;

function syncThemeChecks(): void {
  const selected = ConfigurationService.getValue("workbench.colorTheme");
  for (const theme of COLOR_THEMES) ContextKeyService.set(themeCheckKey(theme.id), theme.id === selected);
}

syncThemeChecks();
ConfigurationService.onDidChange(syncThemeChecks);
