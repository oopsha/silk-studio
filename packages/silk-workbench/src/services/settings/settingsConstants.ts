export const SETTINGS_EDITOR_URI = "silk://settings";

export type BuiltInSettingsCategory =
  | "appearance"
  | "editor"
  | "database"
  | "queryResult"
  | "ai"
  | "experimental";

/** App-contributed settings categories share the editor while keeping app-only settings out of other studios. */
export type SettingsCategory = BuiltInSettingsCategory | (string & {});

export const SETTINGS_CATEGORY_LABELS: Record<BuiltInSettingsCategory, string> = {
  appearance: "Appearance",
  editor: "Editor",
  database: "Database",
  queryResult: "Query Result",
  ai: "AI",
  experimental: "Experimental",
};

export const SETTINGS_CATEGORY_ORDER: SettingsCategory[] = [
  "appearance",
  "editor",
  "database",
  "queryResult",
  "ai",
  "experimental",
];

export const SETTINGS_CATEGORY_AVAILABLE: Record<BuiltInSettingsCategory, boolean> = {
  appearance: true,
  editor: true,
  database: true,
  queryResult: true,
  ai: true,
  experimental: true,
};
