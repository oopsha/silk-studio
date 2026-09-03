# Silk DB Studio — User Guide

*[한국어](./user-guide.ko.md)*

A complete guide to installing, connecting, and working with Silk DB Studio.

## Install

1. Download the **macOS** or **Windows** build from [GitHub Releases](https://github.com/oopsha/silk-studio/releases).
2. Install / open the app as usual for your OS.
3. Packaged builds include **jdbc-agent** and a bundled **Eclipse Temurin JRE 17** — you do **not** need a system Java install for SQL/connections.

## Updates

Silk checks for updates **automatically** — shortly after launch, then every few hours while the app stays open — so you don't need to remember to check yourself. It stays silent when you're already up to date; if a newer release exists, it asks before downloading, installing, and relaunching. You can also trigger a check anytime via **Manage** (gear in the Activity Bar) → **Check for Updates…**. Updates are verified with Tauri updater signatures; the feed is GitHub Releases' `latest.json`.

The color theme can also be switched from the same gear menu's **Themes** submenu — see [Appearance and themes](#appearance-and-themes).

## Creating a connection

Open the **Connections** panel in the sidebar and click **New Connection** to open the connection form as an editor tab. Fields:

- **Name** — a label for this profile, shown throughout the app.
- **Driver** — **Oracle**, **SQL Server**, **MySQL**, **MariaDB**, or **PostgreSQL**.
- **Host** / **Port**, plus a driver-specific field: **Database** (SQL Server/MySQL/MariaDB/PostgreSQL) or, for Oracle, **Database** with a **Service Name / SID** choice. Check **"Advanced: enter JDBC URL directly"** to type a raw JDBC URL instead of the structured fields.
- **User** / **Password**, with a **"Save this password"** checkbox (checked by default). Uncheck it to use the password only for this session without storing it.
- **Default Schema** (Oracle, PostgreSQL) — type a name, or connect once and click **Load schemas** to pick from the database's actual schema list.
- **Show system objects** — include database-internal schemas/objects in the Explorer tree and search.

Click **Test** to verify the credentials (and any tunnel — see below) without saving. Once saved, a **Connect** button appears.

**Passwords are never stored in plain text or in exported files.** They go through your OS's credential store (Windows Credential Manager, macOS Keychain, or the Linux Secret Service) via the same mechanism used for AI provider API keys.

### Connecting through a tunnel

A connection can use **at most one** tunnel type. Enabling one automatically disables the other.

**SSH jump host** — check **"Connect via SSH jump host"** and fill in Jump Host / Port / Username, then choose **Password** or **Private key** (with an optional passphrase) as the authentication method. An optional **second hop** lets you chain a second SSH login for databases only reachable after two jumps.

**AWS SSM tunnel** — check **"Connect via AWS SSM tunnel"** and fill in **AWS Region**, **SSO Start URL**, and **Target Instance** (an SSM-managed EC2 instance ID). The connection's own Host/Port fields must be the database's real address as seen *from that instance* (e.g. an RDS endpoint), not `localhost`. Click **Load Instances** to sign in with AWS SSO (a browser window opens for the device-code login) and pick from the instances that SSM can reach; signing in again isn't needed until the cached session expires.

### Managing connections

- **New Query with this Connection**: hover a connection row (or right-click it) for a dedicated new-query action — it opens a SQL tab in that connection's dialect and binds it to that specific profile, regardless of which connection is currently active. If the profile isn't connected yet, the tab opens immediately and the connection is started in the background.
- **Edit**: click a saved connection to reopen the form pre-filled.
- **Duplicate** / **Delete**: available from the connection row's hover actions or right-click menu. Delete asks for confirmation.
- **Export**: choose all connections or a selection, saved as a JSON file. Passwords are **never** included.
- **Import**: pick a previously-exported JSON file; a review dialog flags name conflicts and lets you choose which profiles to bring in. Imported profiles are always created fresh (never overwrite an existing one) and start with **no saved password** — enter it once after importing.

(App **settings**, as opposed to connection profiles, have their own separate export/import — see [Settings overview](#settings-overview).)

## Working with multiple connections

You can keep **any number of connections open at once**. Each SQL editor tab has its own query target — the connection (and, for Oracle/PostgreSQL, the schema; for the others, the database/catalog) it runs against:

- The **status bar** (bottom-left) shows the focused tab's connection and, next to it, its database/schema. Click either to change it.
- Editor tabs show a short connection name as a muted suffix; hover a tab for its full target.
- Running or Explaining a statement always uses the *focused tab's* binding, and each SQL tab keeps its own result panel — running a query in one tab never touches another tab's results.
- The Explorer marks connected profiles; opening a table's data or an object's editor uses that object's own connection.
- A disconnected tab binding stays as-is until you reconnect or change it — Silk never silently reroutes a tab to a different connection.

**Switching the current database/schema** (via the status-bar picker, or right-clicking a catalog/schema in the Explorer for "Use This Database"/"Use This Schema") changes it for every open SQL tab bound to that same connection, not just the one you clicked from — this is because tabs on the same connection share one live database session. Use **"Set as Default Database"** (catalog-based drivers) or **"Set as Default Schema"** (Oracle, PostgreSQL) to also persist the choice as that connection profile's saved default, so it's used again next time you connect.

## Transactions

With **autocommit off** (Settings → Database), a connection's writes stay uncommitted until you say so. Once a connection has an uncommitted write, a status-bar pill appears on any tab bound to it, with inline **Commit** and **Rollback** buttons (the same actions are also on the Run menu, and reachable from the Command Palette). Rollback asks for confirmation first; Commit doesn't.

Because this pending-transaction state belongs to the *connection*, not the tab, it's shared: every tab bound to that connection sees the same pill, and committing or rolling back from any one of them applies to all of them and refreshes their open result tabs. Disconnecting or closing the app with uncommitted writes doesn't prompt you first — the transaction's fate then follows your database's own session-close behavior, not Silk's.

## Exploring your database

The Explorer tree shows, per connection: (SQL Server only) databases, then schemas, then object-kind folders (Tables, Views, Procedures, Functions, Packages, and so on), then individual objects.

- **Filter box** at the top of the Explorer does a live substring filter over whatever is *already loaded/expanded* in the tree — it won't reach into schemas you haven't opened yet, and it doesn't search other connections.
- The small search icon next to the filter box, or **Ctrl+Shift+O**, opens a quick pick that also type-searches already-loaded objects across every connected profile; typing 2+ characters offers a "Search across connections…" action for a live, real-time database search.
- The dedicated **Search** panel in the sidebar is the most thorough option: pick which connections to search and which object kinds to include (indexes and synonyms are excluded by default, since they're usually just index/constraint artifacts rather than what you're looking for). It **automatically connects** any selected-but-not-yet-connected profile before searching, streams results in as each connection finishes, shows a Cancel button while running, and flags any connection that timed out or errored instead of silently dropping it.
- Double-click (or Enter) a table/view to open its **Object Editor**; a procedure, function, package, or trigger opens the **DDL viewer**.
- Right-click any object for Open Data, Edit Source / View DDL, Copy Name, Rename, and Drop (the last two only where the driver and your permissions allow it, and never in read-only mode).

## Viewing and editing database objects

**Object Editor** (tables and views) has two tabs:
- **Properties** — Columns, Indexes, Foreign Keys, References, Constraints, Triggers, and Dependencies sub-sections (some of these only apply to tables, since a view has no physical storage). Columns are editable when the driver supports table structure editing; everything else here is read-only, **except** a view's DDL section, which becomes an editable SQL buffer with Save / Compile / Snapshot / History actions when the driver supports it.
- **Data** — runs and shows the table/view's rows (see [Query results](#working-with-query-results) below for editing them).

**DDL viewer** (procedures, functions, packages, triggers) shows Declaration / Arguments / Dependencies side sections (packages split further into Spec and Body, since each can be edited independently). The Declaration/Spec/Body sections become editable buffers wherever the driver supports it.

**Saving and compiling** a PL/SQL object: press **Ctrl+S**. Rather than writing a file, this opens a confirmation dialog showing the generated SQL, a diff against what's currently in the database, and any warnings — nothing is applied until you confirm. **Ctrl+Shift+F9** compiles the object explicitly. Compile errors are reported inline and as markers in the editor so you can jump straight to the offending line; on Oracle, compiling also runs a diagnostics pass that surfaces warnings the database wouldn't otherwise report at save time.

## Writing and running SQL

| Shortcut | Action |
| --- | --- |
| `Ctrl+Enter` | Run the current statement |
| `Ctrl+Shift+Enter` | Execute the whole script (or selection); on SQL Server this also handles `GO` batches. Stops on the first error and rolls back the open transaction; the result tab shows a short summary (success count + errors) rather than one line per batch |
| `Ctrl+Alt+E` | Explain the current statement |
| `Ctrl+K` then `Ctrl+O` | Change this tab's connection/database/schema target |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+K` then `Ctrl+S` | Keyboard Shortcuts (searchable, see [Customizing keyboard shortcuts](#customizing-keyboard-shortcuts)) |
| `Ctrl+Shift+O` | Search database objects across every connected profile (see [Exploring your database](#exploring-your-database)) |
| `Ctrl+,` | Settings |

The **Command Palette** (`Ctrl+Shift+P`) lists every command with its current shortcut next to it; type to filter by name, id, or key — there's no special search syntax, just plain matching.

While a statement is running, a **Cancel Query** action appears (Run menu, or Command Palette); it asks the database driver to cancel the in-flight statement rather than closing the connection. If it was part of a manual transaction, the transaction itself stays open afterward — you still commit or roll back explicitly. After a run finishes, the result panel shows the row count; how long it took is recorded in **Query History** (see below) rather than shown live in the result panel.

**Explain** runs the statement's query-plan output instead of its rows, into the same result panel as a normal run. It works for whatever single statement is in the editor (not only `SELECT`) and uses each dialect's own mechanism under the hood (Oracle's `DBMS_XPLAN`, SQL Server's `SHOWPLAN`, MySQL/PostgreSQL's `EXPLAIN`) — the exact plan format you see follows whatever that database returns.

### SQL IntelliSense

Connect to a database, open a SQL editor tab, then use **Ctrl+Space** or type after `.` to open suggestions. What's offered depends on cursor position and on the focused tab's connection dialect:

| When | What you should see |
| --- | --- |
| Empty statement / after `;` | Statement starters only (`SELECT`, `WITH`, `INSERT`, …) — not functions |
| After `SELECT ` | Columns (once `FROM` is known) and dialect functions (e.g. Oracle's `TO_CHAR`) |
| After `FROM ` / `JOIN ` | Schemas, tables, CTEs — not expression functions |
| `FROM emp e` then `e.` | Columns of `emp` |
| `WITH c AS (SELECT id FROM t) … c.` | CTE columns such as `id` |
| Inside a nested `(SELECT … FROM dept d WHERE d.` | Only the inner `dept` — the outer `FROM` table shouldn't leak in |
| Accepting a function like `NVL` / `ISNULL` | A snippet with placeholders; typing `(` may show argument hints |

Suggestions favor the connection's default schema so large catalogs stay responsive, and switching or disconnecting a connection clears cached completion metadata.

### Drag and drop

| Action | Result |
| --- | --- |
| Drop a `.sql`/text file onto the window | Opens it as an editor tab |
| An open file changes on disk | A clean tab reloads automatically; a dirty tab asks first |
| Drag an Explorer object onto the SQL editor | Inserts `schema.object` at the cursor |
| Drag editor tabs | Reorders them |

## Splitting the editor into panes

Drag a tab to an edge of the editor area, or use the Command Palette's **Split Editor Right**, to open a second pane. Panes can be split further and resized by dragging the divider between them. **Lock Editor Group** pins whatever's currently showing in a pane so opening other tables/objects doesn't replace it — new tabs open in another pane instead. **Close Editor Group** closes an entire pane and everything in it.

## Closing tabs and unsaved work

Silk automatically remembers every open tab's content — including unsaved (dirty) SQL, PL/SQL, and DDL buffers — across an app restart, so you don't need to save a scratch query before quitting; it comes back exactly as you left it next time you open the app.

That safety net covers restarting the *app*, not closing an individual *tab*: since closing a tab removes it from what gets remembered, Silk asks for confirmation whenever you close a tab (via its × button, the sidebar's Open Editors list, middle-click, or `Ctrl+W`) while it still has unsaved changes, for any tab type.

## Query History

The Activity Bar's **Query History** icon lists every statement you've run, newest first, each showing its status, timestamp, duration, connection, a preview of the SQL, and a short result/error summary. From an entry you can re-run it, open it in a new editor tab, insert it into the tab you're currently in, or star it as a **Favorite**; a filter box searches across the SQL text, summary, connection name, and status. History is capped at the 100 most recent runs and is shared across all connections, not kept separately per connection — the same store backs the AI chat's "Include query history" context toggle.

## Working with query results

A `SELECT` from a single table becomes editable in its result grid once you run it, provided the table has a primary key that's included in the selected columns (results from a view, a join, or a table with no primary key stay read-only, and read-only mode always overrides this).

- **Edit a cell** by clicking into it. On an existing row the primary-key column(s) can't be edited (changing a key on a saved row wouldn't do anything useful); on a newly added or duplicated row they're editable so you can fill in a new key.
- **Add Row** inserts a blank editable row; **Duplicate Row** copies the one selected row and blanks its primary key for you to fill in.
- Deleting a row marks it for deletion rather than removing it immediately — a badge tracks how many rows are pending changes.
- **Save** becomes active once there are pending edits. It opens a preview of the exact `UPDATE`/`INSERT`/`DELETE` statements it will run, with row/cell counts, for you to confirm before anything is written.
- The toolbar's context menu offers **Copy Selection**, **Copy Selected Rows**, **Copy All (Filtered)**, and **Export CSV (Filtered)**.
- Column headers support sorting and, when enabled in Query Result settings, per-column filters with an Apply/Reset floating filter row.
- **Save column layout** remembers the current column widths, order, sort, and filter state for that tab.

## AI Chat

Silk's AI chat is **bring-your-own-key**: you connect your own account with a supported provider, and no query or schema data goes anywhere except directly between your machine and that provider.

### Setting it up

1. Open **Settings** (`Ctrl+,`) → **AI**, and turn it on.
2. Pick a **Provider** — Gemini, OpenAI, Anthropic, or **Custom** (any OpenAI-API-compatible endpoint, with its own Base URL field).
3. Pick a **Model** from the preset list (or type one, for Custom).
4. Paste your **API key** and click Save. **Test Connection** confirms it works before you rely on it.

Your key is stored in your OS credential store, the same way connection passwords are — never in plain settings files.

### Using it

- Open the panel with **Ctrl+Shift+A**, or from the sidebar.
- There is a single ongoing conversation; **New AI Chat** clears it (no undo). History persists across restarts.
- What the assistant sees is controlled by four toggles in Settings → AI: **Include schema context** (a summary of what you've browsed in the Explorer), **Include editor selection** (the active tab's selected text, or the whole buffer if nothing's selected), **Include query history**, and **Include open PL/SQL dependencies** (source/dependencies/columns for any PL/SQL object tab you have open).
- The assistant can look up object source, DDL, dependencies, and columns, and open an object's editor tab for you — but it **cannot run queries or write to the database on its own**. When it proposes SQL, it appears as a code block with **Review**, **Copy**, and (if you've turned on **Allow SQL Execution** in Settings → AI) an **Execute…** button that opens a confirmation dialog before anything actually runs.

### AI Call Log

**Help → AI Call Log** shows a running list of every request made to your AI provider — timestamp, provider/model, success or error, token counts, an estimated cost, and how long it took. It **never stores prompts, responses, or your API key** — metadata only — so it's meant for keeping an eye on usage/cost and catching failures, not for reviewing exactly what was said. **Export** saves it as a JSON file; **Clear** (with confirmation) empties the log only — it doesn't touch your chat history.

## Settings overview

Open Settings with **Ctrl+,**:

- **Appearance** — language, color theme, UI font size.
- **Editor** — font size, tab size, line numbers, minimap, sticky scroll, word wrap.
- **Database** — query timeout, autocommit, **read-only mode**, Explorer preload behavior, and bind-parameter placeholder style. Read-only mode is a single switch covering every connection at once: it blocks any write statement (`INSERT`/`UPDATE`/`DELETE`/DDL/etc., checked at the moment you try to run it, not just when saving), Explorer's Rename/Drop actions, saving query-result grid edits, PL/SQL save/compile, and AI-proposed SQL execution — `SELECT`/read-only statements and Explain still work normally.
- **Query Result** — max rows, row height, column filters, and related grid behavior.
- **AI** — provider, model, API key, and the context/execution toggles above.

App **settings** (as a whole) can be exported/imported as a JSON file from here as well — this is separate from, and doesn't include, connection profiles.

## Language

1. Open **Settings** (`Ctrl+,`) → **Appearance**.
2. Set **Language** to **English** or **한국어**.
3. The whole UI — menus, Settings, Explorer, query panel, dialogs, AI chat — updates immediately and the choice is saved for next launch.

The first run without a saved preference follows your OS/browser language (Korean locales default to 한국어, otherwise English).

## Appearance and themes

Settings → Appearance → **Color Theme** offers **System**, **Dark**, and **Light**. **System** follows your OS's light/dark setting automatically. The same three options are also available from the gear (Manage) menu's **Themes** submenu, so you can switch without opening Settings.

## Customizing keyboard shortcuts

Open the searchable **Keyboard Shortcuts** editor with **Ctrl+K** then **Ctrl+S**, or from the Manage menu.

- Type to filter by command name or current key.
- Click the pencil icon on a row, then press the key combination you want — it's captured live, and a checkmark commits it.
- If the combination is already used elsewhere, a warning names the conflicting command(s); it doesn't block you from setting it anyway.
- Rows you've changed from the default get a "changed" badge, with a reset icon to restore the original.

## Diagnostics

| Help menu | What it does |
| --- | --- |
| **Copy Diagnostics** | Copies a redacted support summary to the clipboard |
| **Open Log Folder** | Opens the app's log directory |
| **About** | Shows product name and version |

Toasts use a polite live region so screen readers hear success/error messages.
