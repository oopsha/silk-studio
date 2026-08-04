export type ColorThemeId = "dark-2026" | "dark-plus";
export type LineNumbersMode = "on" | "off" | "relative";
export type WordWrapMode = "off" | "on";
export type AiProviderId = "gemini" | "openai" | "anthropic" | "custom";
export type LocaleId = "en" | "ko";

export const AI_PROVIDER_IDS: readonly AiProviderId[] = [
  "gemini",
  "openai",
  "anthropic",
  "custom",
] as const;

export type WorkbenchConfiguration = {
  "window.commandCenter": boolean;
  "workbench.navigationControl.enabled": boolean;
  "workbench.layoutControl.enabled": boolean;
  "workbench.colorTheme": ColorThemeId;
  "workbench.fontSize": number;
  "workbench.locale": LocaleId;
  "editor.fontSize": number;
  "editor.tabSize": number;
  "editor.insertSpaces": boolean;
  "editor.lineNumbers": LineNumbersMode;
  "editor.minimap.enabled": boolean;
  "editor.stickyScroll.enabled": boolean;
  "editor.wordWrap": WordWrapMode;
  "queryResult.rowHeight": number;
  "queryResult.fontSize": number;
  "queryResult.nullDisplay": string;
  "queryResult.maxRows": number;
  "queryResult.filterEnabled": boolean;
  "database.queryTimeoutSec": number;
  "database.autoCommit": boolean;
  "database.readOnly": boolean;
  "database.explorer.preloadDefaultSchema": boolean;
  /** Prompt for `?` (or configured mark) placeholders before execute. */
  "sql.parameters.anonymousEnabled": boolean;
  /** Prompt for `:name` (or configured prefix) placeholders before execute. */
  "sql.parameters.namedEnabled": boolean;
  "ai.enabled": boolean;
  "ai.provider": AiProviderId;
  "ai.model": string;
  "ai.customBaseUrl": string;
  "ai.context.includeSchema": boolean;
  "ai.context.includeSelection": boolean;
  "ai.context.includeQueryHistory": boolean;
  "ai.allowExecute": boolean;
};

export const CONFIGURATION_DEFAULTS: WorkbenchConfiguration = {
  "window.commandCenter": true,
  "workbench.navigationControl.enabled": true,
  "workbench.layoutControl.enabled": true,
  "workbench.colorTheme": "dark-2026",
  "workbench.fontSize": 13,
  "workbench.locale": "en",
  "editor.fontSize": 14,
  "editor.tabSize": 4,
  "editor.insertSpaces": true,
  "editor.lineNumbers": "on",
  "editor.minimap.enabled": true,
  "editor.stickyScroll.enabled": false,
  "editor.wordWrap": "off",
  "queryResult.rowHeight": 26,
  "queryResult.fontSize": 12,
  "queryResult.nullDisplay": "NULL",
  "queryResult.maxRows": 200,
  "queryResult.filterEnabled": true,
  "database.queryTimeoutSec": 30,
  "database.autoCommit": true,
  "database.readOnly": false,
  "database.explorer.preloadDefaultSchema": true,
  "sql.parameters.anonymousEnabled": false,
  "sql.parameters.namedEnabled": true,
  "ai.enabled": false,
  "ai.provider": "gemini",
  "ai.model": "gemini-3.5-flash",
  "ai.customBaseUrl": "",
  "ai.context.includeSchema": true,
  "ai.context.includeSelection": true,
  "ai.context.includeQueryHistory": false,
  "ai.allowExecute": false,
};

export type ConfigurationKey = keyof WorkbenchConfiguration;
