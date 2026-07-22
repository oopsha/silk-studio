import type { WorkbenchConfiguration } from "./configurationDefaults";

export function applyWorkbenchConfiguration(
  configuration: WorkbenchConfiguration,
): void {
  const root = document.documentElement;
  root.dataset.colorTheme = configuration["workbench.colorTheme"];
  root.style.setProperty(
    "--workbench-font-size",
    `${configuration["workbench.fontSize"]}px`,
  );
}
