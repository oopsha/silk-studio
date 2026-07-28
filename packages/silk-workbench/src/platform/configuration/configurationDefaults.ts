export type ColorThemeId = "dark-2026" | "dark-plus";
export type LineNumbersMode = "on" | "off" | "relative";
export type WordWrapMode = "off" | "on";
export type AiProviderId = "openai" | "anthropic" | "custom";

export type WorkbenchConfiguration = {
  "window.commandCenter": boolean;
  "workbench.navigationControl.enabled": boolean;
  "workbench.layoutControl.enabled": boolean;
  "workbench.colorTheme": ColorThemeId;
  "workbench.fontSize": number;
  "editor.fontSize": number;
  "editor.tabSize": number;
  "editor.insertSpaces": boolean;
  "editor.lineNumbers": LineNumbersMode;
  "editor.minimap.enabled": boolean;
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
  "ai.enabled": boolean;
  "ai.provider": AiProviderId;
  "ai.model": string;
  "ai.apiKey": string;
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
  "editor.fontSize": 14,
  "editor.tabSize": 4,
  "editor.insertSpaces": true,
  "editor.lineNumbers": "on",
  "editor.minimap.enabled": true,
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
  "ai.enabled": false,
  "ai.provider": "openai",
  "ai.model": "gpt-4o-mini",
  "ai.apiKey": "",
  "ai.context.includeSchema": true,
  "ai.context.includeSelection": true,
  "ai.context.includeQueryHistory": false,
  "ai.allowExecute": false,
};

export type ConfigurationKey = keyof WorkbenchConfiguration;
