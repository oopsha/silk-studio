import { resolveEffectiveColorTheme } from "@silk-studio/ui/platform/colorTheme.ts";
import type { WorkbenchConfiguration } from "./configurationDefaults";

export function applyWorkbenchConfiguration(
  configuration: WorkbenchConfiguration,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const effectiveTheme = resolveEffectiveColorTheme(
    configuration["workbench.colorTheme"],
  );
  root.dataset.colorTheme = effectiveTheme;
  // Native form controls (checkboxes, scrollbars, etc.) render from this, not our own
  // `--color-*` tokens — index.html's static `<meta color-scheme>` only covers the very first
  // paint, so keep it in sync on every theme change (including live "system" OS-theme changes).
  root.style.colorScheme = effectiveTheme;
  root.style.setProperty(
    "--workbench-font-size",
    `${configuration["workbench.fontSize"]}px`,
  );
}
