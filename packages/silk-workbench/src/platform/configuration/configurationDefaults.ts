import type { ColorThemeId } from "@silk-studio/ui/platform/colorTheme.ts";
export type { ColorThemeId };
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
  /** Prefix for named placeholders, e.g. `:` for `:name`. Independent of MyBatis support below. */
  "sql.parameters.namedPrefix": string;
  /**
   * When enabled, recognizes MyBatis's `#{name}` and `${name}` placeholders (each with an
   * optional `,jdbcType=...` suffix) regardless of `sql.parameters.namedPrefix` — so `:name`
   * and MyBatis-style placeholders can both be prompted for in the same statement.
   */
  "sql.parameters.mybatisEnabled": boolean;
  "ai.enabled": boolean;
  "ai.provider": AiProviderId;
  "ai.model": string;
  "ai.customBaseUrl": string;
  "ai.context.includeSchema": boolean;
  "ai.context.includeSelection": boolean;
  "ai.context.includeQueryHistory": boolean;
  /** Open PL/SQL tabs: source + compile-time dependencies + referenced columns. */
  "ai.context.includePlsqlDeps": boolean;
  "ai.allowExecute": boolean;
  /**
   * Temporary: dump AI HTTP request/response JSON into an editor tab.
   * Intended for developers; may be removed or gated later.
   */
  "ai.debug.dumpHttp": boolean;
};

export const CONFIGURATION_DEFAULTS: WorkbenchConfiguration = {
  "window.commandCenter": true,
  "workbench.navigationControl.enabled": true,
  "workbench.layoutControl.enabled": true,
  "workbench.colorTheme": "dark",
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
  "database.autoCommit": false,
  "database.readOnly": false,
  "database.explorer.preloadDefaultSchema": true,
  "sql.parameters.anonymousEnabled": true,
  "sql.parameters.namedEnabled": true,
  "sql.parameters.namedPrefix": ":",
  "sql.parameters.mybatisEnabled": true,
  "ai.enabled": true,
  "ai.provider": "gemini",
  "ai.model": "gemini-3.5-flash",
  "ai.customBaseUrl": "",
  "ai.context.includeSchema": true,
  "ai.context.includeSelection": true,
  "ai.context.includeQueryHistory": false,
  "ai.context.includePlsqlDeps": true,
  "ai.allowExecute": false,
  "ai.debug.dumpHttp": false,
};

export type ConfigurationKey = keyof WorkbenchConfiguration;
