import { resolveEffectiveColorTheme } from "@silk-studio/ui/platform/colorTheme.ts";
import type { WorkbenchConfiguration } from "./configurationDefaults";

export function applyWorkbenchConfiguration(
  configuration: WorkbenchConfiguration,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.colorTheme = resolveEffectiveColorTheme(
    configuration["workbench.colorTheme"],
  );
  root.style.setProperty(
    "--workbench-font-size",
    `${configuration["workbench.fontSize"]}px`,
  );
}
