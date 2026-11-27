/**
 * English text for labels an app registers in its own language (menu and command titles written
 * in Korean). Looked up by `localizeUiLabel` after the shared English → locale map.
 */
let englishByLabel: Readonly<Record<string, string>> = {};

export function registerAppLabels(labels: Readonly<Record<string, string>>): void {
  englishByLabel = { ...englishByLabel, ...labels };
}

export function appEnglishLabel(label: string): string | undefined {
  return englishByLabel[label];
}
