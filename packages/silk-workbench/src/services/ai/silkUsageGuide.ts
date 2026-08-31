import type { AiToolDefinition } from "./aiToolTypes";

/**
 * Curated from docs/user-guide.md — keep in sync with it when that doc changes. Served through
 * the get_silk_usage_guide tool (see silkUsageGuideTool.ts wiring) rather than pasted into every
 * system prompt, so growing this content doesn't cost tokens on requests that don't need it.
 */
export type SilkUsageTopic = {
  id: string;
  title: string;
  content: string;
};

export const SILK_USAGE_TOPICS: readonly SilkUsageTopic[] = [
  {
    id: "connections",
    title: "Creating and managing connections",
    content: [
      "Creating a connection: Connections panel → New Connection. Fields: Name, Driver (Oracle/SQL Server/MySQL/MariaDB/PostgreSQL), Host/Port or a raw JDBC URL, User/Password ('Save this password' checkbox, checked by default), Default Schema (Oracle/PostgreSQL — type it or connect once and click 'Load schemas'), and 'Show system objects'. A 'Test' button verifies credentials before saving; 'Connect' appears after saving. Passwords go through the OS credential store, never plain text, and are never included in exported connection files.",
      "Tunnels: a connection uses at most one of SSH jump host or AWS SSM tunnel (enabling one disables the other). SSH: 'Connect via SSH jump host' → Jump Host/Port/Username, then Password or Private key (+ optional passphrase); an optional second-hop chains a second SSH login. SSM: 'Connect via AWS SSM tunnel' → AWS Region, SSO Start URL, Target Instance (an SSM-managed EC2 instance id) — the connection's own Host/Port must be the DB's real address as seen from that instance (e.g. an RDS endpoint), not localhost. 'Load Instances' triggers an AWS SSO browser sign-in, cached until it expires.",
      "Managing connections: edit by clicking a saved connection; duplicate/delete from its row's hover actions (delete asks for confirmation); export (all or a selection, JSON, never includes passwords) and import (review dialog flags name/connection-info conflicts, always creates fresh profiles with no saved password) are separate from — and not the same feature as — exporting/importing general app Settings.",
      "Multiple connections: any number can stay connected at once. Each SQL tab has its own query target — shown in the bottom-left status bar (connection, then database/schema) — click either to change it. Editor tabs show a muted connection-name suffix (hover for the full target). Run/Explain always use the focused tab's binding and each tab keeps its own result panel. A disconnected tab binding stays as-is until reconnected or changed; Silk never silently reroutes a tab to a different connection.",
      "Switching database/schema (status-bar picker, or Explorer 'Use This Database'/right-click a catalog) applies to every open tab bound to that SAME connection, not just the tab you clicked from, because tabs on one connection share a single live session — do not tell the user this is 'just for this tab'. 'Set as Default Database' additionally persists the choice as that connection profile's saved default.",
    ].join(" "),
  },
  {
    id: "transactions",
    title: "Transactions (commit/rollback)",
    content:
      "With autocommit off (Settings → Database), an uncommitted write on a connection shows a status-bar pill with Commit/Rollback (also on the Run menu) on every tab bound to that connection — it's per-connection, not per-tab, so committing/rolling back from any one of them applies to all and refreshes their result tabs. Rollback confirms first; Commit doesn't. Disconnecting or closing the app with an open transaction is not confirmed by Silk.",
  },
  {
    id: "explorer",
    title: "Exploring and searching the database",
    content:
      "Explorer tree: connection → (SQL Server only) database → schema → object-kind folders (Tables/Views/Procedures/Functions/Packages/…) → objects. The filter box only searches what's already loaded/expanded, not other connections. Ctrl+Shift+O opens a quick pick that type-searches loaded objects across connected profiles, with a 'Search across connections…' live-search option once you type 2+ characters. The sidebar Search panel is the most thorough: pick connections and object kinds (indexes/synonyms excluded by default), it auto-connects selected-but-disconnected profiles, streams results per connection, shows Cancel while running, and flags any connection that timed out instead of hiding it. Double-click/Enter a table/view opens the Object Editor; a procedure/function/package/trigger opens the DDL viewer. Right-click an object for Open Data / Edit Source / View DDL / Copy Name / Rename / Drop.",
  },
  {
    id: "objects",
    title: "Object Editor and DDL viewer",
    content: [
      "Object Editor (tables/views) has Properties (Columns editable when the driver supports table-structure edit; Indexes/Foreign Keys/References/Constraints/Triggers/Dependencies read-only, some table-only since views have no physical storage; a view's DDL section is an editable buffer with Save/Compile/Snapshot/History where the driver supports it) and Data (see the query-results topic — it's the same editable grid).",
      "DDL viewer (procedures/functions/packages/triggers) shows Declaration/Arguments/Dependencies (packages split further into Spec/Body). Ctrl+S on a PL/SQL buffer opens a confirmation dialog with the generated SQL and a diff against the DB — nothing is applied until confirmed (Save As is not available for these). Ctrl+Shift+F9 compiles explicitly; errors surface inline and as editor markers; Oracle additionally runs a compile-diagnostics pass after save.",
    ].join(" "),
  },
  {
    id: "sql-editing",
    title: "Writing, running, and organizing SQL",
    content: [
      "Keyboard shortcuts: Ctrl+Enter runs the current statement; Ctrl+Shift+Enter executes the whole script/selection (handles SQL Server GO batches), stopping on the first error and rolling back, with a short summary rather than one line per batch; Ctrl+Alt+E explains the current statement; Ctrl+K then Ctrl+O opens the query-target (connection/database/schema) picker for the focused tab; Ctrl+Shift+P opens the Command Palette; Ctrl+, opens Settings; Ctrl+K then Ctrl+S opens the searchable Keyboard Shortcuts editor.",
      "Command Palette (Ctrl+Shift+P) lists every command with its current shortcut and filters by plain substring match on name/id/key — no special prefix syntax, commands only.",
      "Explain runs the statement's query plan (not its rows) into the same result panel as a normal run, for whatever single statement is in the editor (not only SELECT), using each dialect's own mechanism (Oracle DBMS_XPLAN, SQL Server SHOWPLAN, MySQL/PostgreSQL EXPLAIN) — the plan format follows whatever that database returns. A running query can be cancelled (Run menu / Command Palette); this asks the driver to cancel the statement without closing the connection, and if it was part of a manual transaction, the transaction itself stays open until explicitly committed/rolled back. Row count shows in the result panel; how long a run took is recorded in Query History, not shown live in the result panel.",
      "Customizing shortcuts: in the Keyboard Shortcuts editor, filter by command/key, click a row's pencil icon and press the new combination to capture and commit it; a conflicting existing binding is warned about but not blocked; changed rows get a 'changed' badge with a reset option.",
      "Splitting the editor: drag a tab to an edge of the editor area, or use Split Editor Right, to open another pane; panes can be split further and resized. Lock Editor Group pins what's showing in a pane so opening other objects doesn't replace it (they open in another pane instead); Close Editor Group closes the whole pane.",
      "Closing tabs: Silk remembers every open tab's content (including unsaved SQL/PL-SQL/DDL) across an app restart, so unsaved work survives quitting and reopening the app. That safety net doesn't cover closing an individual tab (× button, the sidebar's Open Editors list, middle-click, or Ctrl+W) — closing a tab removes it from what gets remembered, so Silk asks for confirmation first whenever the tab being closed has unsaved changes, regardless of tab type.",
      "SQL IntelliSense: Ctrl+Space or typing '.' opens suggestions; what's offered depends on cursor position (statement starters at an empty statement, columns/functions after SELECT, schemas/tables/CTEs after FROM/JOIN, a table's own columns after 'alias.') and on the focused tab's connection dialect (Oracle/SQL Server/MySQL-MariaDB/PostgreSQL). Suggestions favor the default schema for responsiveness; switching or disconnecting a connection clears cached column metadata.",
      "Drag and drop: dropping a .sql/text file onto the window opens it as a tab; dragging an Explorer object onto the SQL editor inserts 'schema.object' at the caret; dragging tabs reorders them; an externally-edited open file reloads automatically if it's clean, or asks first if it's dirty.",
    ].join(" "),
  },
  {
    id: "query-results",
    title: "Query results grid and query history",
    content: [
      "Query results: a single-table SELECT becomes an editable grid once run, IF the table has a primary key that's included in the selected columns (views, joins, and PK-less tables stay read-only; read-only mode always overrides this). Existing rows can't have their PK column edited; new/duplicated rows can. 'Add Row' inserts a blank row; 'Duplicate Row' copies the one selected row with its PK blanked. Deleting a row marks it pending rather than removing it immediately. 'Save' is enabled once there are pending edits and opens a preview of the exact UPDATE/INSERT/DELETE statements before anything runs. The toolbar also has Copy Selection/Selected Rows/All(Filtered) and Export CSV (Filtered), sortable/filterable columns, and 'Save column layout'.",
      "Query History (Activity Bar icon): lists every run statement, newest first, with status/timestamp/duration/connection/a SQL preview/a result-or-error summary; entries can be re-run, opened in a new tab, inserted into the current tab, or starred as a Favorite; a filter box searches SQL/summary/connection/status. Capped at the 100 most recent runs, shared across all connections (not per-connection) — this is the exact store the AI chat's 'Include query history' toggle pulls from.",
    ].join(" "),
  },
  {
    id: "ai-chat",
    title: "The AI chat feature itself",
    content: [
      "This AI chat: BYOK — Settings → AI: enable it, pick a Provider (Gemini/OpenAI/Anthropic/Custom with its own Base URL), pick or type a Model, paste an API key and Save ('Test Connection' validates it); the key goes to the OS credential store, never plain settings. Open the chat with Ctrl+Shift+A. There is one ongoing conversation — 'New AI Chat' clears it with no undo; history persists across restarts. Four Settings → AI toggles control what's sent as context: Include schema context, Include editor selection, Include query history, Include open PL/SQL dependencies. The assistant cannot run queries or write to the DB directly — a proposed SQL block gets Review/Copy buttons and, only if 'Allow SQL Execution' is on, an Execute… button that opens a confirmation dialog before anything runs.",
      "AI Call Log (Help menu): a metadata-only log of requests made to the AI provider — timestamp, provider/model, success/error, token counts, estimated cost, duration. It never stores prompts, responses, or the API key, so it's for usage/cost tracking and catching failures, not for reviewing exact content. Export saves it as JSON; Clear (with confirmation) only empties this log, not the chat history itself.",
    ].join(" "),
  },
  {
    id: "settings",
    title: "Settings, language, themes, keybindings",
    content: [
      "Settings (Ctrl+,) sections: Appearance (language, color theme, UI font size), Editor (font size, tab size, line numbers, minimap, sticky scroll, word wrap), Database (query timeout, autocommit, read-only mode, Explorer preload, bind-parameter style), Query Result (max rows, row height), AI. App Settings as a whole can be exported/imported as JSON here too — separate from, and not including, connection profiles.",
      "Read-only mode is one global switch for every connection: it blocks any write statement at the moment you try to run it (not just at save time), Explorer Rename/Drop, query-result grid saves, PL/SQL save/compile, and AI-proposed SQL execution — SELECT and Explain still work.",
      "Language: Settings → Appearance → Language, English or 한국어; the whole UI including this chat updates immediately and persists.",
      "Appearance/theme: Settings → Appearance → Color Theme, or the gear (Manage) menu's Themes submenu: System (follows the OS), Dark, Light.",
      "Customizing shortcuts is covered under the sql-editing topic (same Keyboard Shortcuts editor is used app-wide, not just for SQL commands).",
    ].join(" "),
  },
  {
    id: "diagnostics",
    title: "Updates and diagnostics",
    content:
      "Manage (gear) → Check for Updates… checks GitHub Releases and offers to install. Help menu: Copy Diagnostics copies a redacted support summary to the clipboard; Open Log Folder opens the app log directory; About shows product name and version.",
  },
] as const;

function formatTopicIndex(): string {
  return SILK_USAGE_TOPICS.map((topic) => `${topic.id} — ${topic.title}`).join(
    "\n",
  );
}

/** Returns one topic's content, or the full guide when `topic` is omitted/unrecognized. */
export function getSilkUsageGuideText(topic?: string): string {
  const normalized = topic?.trim().toLowerCase();
  if (!normalized) {
    return SILK_USAGE_TOPICS.map(
      (item) => `### ${item.title}\n${item.content}`,
    ).join("\n\n");
  }
  const match = SILK_USAGE_TOPICS.find((item) => item.id === normalized);
  if (!match) {
    return `Unknown topic "${topic}". Available topics:\n${formatTopicIndex()}`;
  }
  return `### ${match.title}\n${match.content}`;
}

export const SILK_USAGE_GUIDE_TOOL: AiToolDefinition = {
  name: "get_silk_usage_guide",
  description:
    "Look up how to use a Silk DB Studio feature — creating/editing connections and tunnels, the Explorer and cross-connection search, the Object/DDL editors and PL/SQL compile workflow, writing/running/splitting SQL editors and keyboard shortcuts, the query result grid and query history, transactions, this AI chat's own settings, and general app Settings/language/theme/diagnostics. Call this whenever the user asks how to do something in Silk itself (not a question about their database's data or schema) and you are not certain of the exact steps — do not guess menu names or shortcuts. Omit `topic` to get the whole guide, or pass one topic id to save space.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: SILK_USAGE_TOPICS.map((item) => item.id),
        description:
          "One topic id to fetch just that section. Omit to get the full guide.",
      },
    },
    additionalProperties: false,
  },
};
