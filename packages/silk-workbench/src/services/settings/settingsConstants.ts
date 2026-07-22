export const SETTINGS_EDITOR_URI = "silk://settings";

export type SettingsCategory =
  | "appearance"
  | "editor"
  | "database"
  | "queryResult"
  | "ai";

export const SETTINGS_CATEGORY_LABELS: Record<SettingsCategory, string> = {
  appearance: "Appearance",
  editor: "Editor",
  database: "Database",
  queryResult: "Query Result",
  ai: "AI",
};

export const SETTINGS_CATEGORY_ORDER: SettingsCategory[] = [
  "appearance",
  "editor",
  "database",
  "queryResult",
  "ai",
];

export const SETTINGS_CATEGORY_AVAILABLE: Record<SettingsCategory, boolean> = {
  appearance: true,
  editor: true,
  database: true,
  queryResult: true,
  ai: true,
};
