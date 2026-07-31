# Silk DB Studio — User Guide

End-user notes for install, updates, shortcuts, and diagnostics.  
In the app: **Help → Documentation** (or Command Palette → “Documentation”).

## Install

1. Download the **macOS** or **Windows** build from [GitHub Releases](https://github.com/oopsha/silk-studio/releases).
2. Install / open the app as usual for your OS.
3. Packaged builds include **jdbc-agent** and a bundled **Eclipse Temurin JRE 17** — you do **not** need a system Java install for SQL/connections.

Developer packaging details: [`bundled-runtime.md`](./bundled-runtime.md).

## Updates

1. Open **Manage** (gear in the Activity Bar) → **Check for Updates…**
2. If a newer release exists, confirm to download, install, and relaunch.
3. Updates are verified with Tauri updater signatures; the feed is GitHub Releases `latest.json`.

Maintainer / signing notes: [`release.md`](./release.md).

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+K` then `Ctrl+S` | Keyboard Shortcuts (searchable list) |
| `Ctrl+,` | Settings |

Open **Help → Keyboard Shortcuts** (or Manage → Keyboard Shortcuts) to search all registered bindings. Editing bindings in the UI is not in v1.

## Language

1. Open **Settings** (`Ctrl+,`) → **Appearance**.
2. Set **Language** to **English** or **한국어**.
3. The workbench UI (menus, Settings, explorer, query panel, dialogs, AI chat) updates immediately. The choice is saved with other settings and restored on next launch.

First run without a saved preference uses the OS/`navigator` language (`ko*` → Korean, otherwise English). Help → Documentation remains English in v1.

## Diagnostics

| Help menu | What it does |
| --- | --- |
| **Copy Diagnostics** | Copies a redacted support summary to the clipboard |
| **Open Log Folder** | Opens the app log directory |
| **About** | Shows product name and version |

Toasts use a polite live region so screen readers hear success/error messages.

## Smoke check (packaged build)

After installing a release build, use [`smoke-checklist.md`](./smoke-checklist.md) (launch + Settings). No database connection is required for that smoke.

## SQL IntelliSense

Connect to a database, open a SQL editor tab, then use **Ctrl+Space** or type after `.` to open suggestions. Behavior depends on **where the cursor is** in the statement and on the **active connection dialect** (Oracle, SQL Server, MySQL/MariaDB, PostgreSQL).

| When | What you should see |
| --- | --- |
| Empty editor / after `;` | Statement starters only (`SELECT`, `WITH`, `INSERT`, …) — **not** functions like `ABS` |
| After `SELECT ` | Columns (when `FROM` is known) and dialect functions (e.g. Oracle `TO_CHAR`) |
| After `FROM ` / `JOIN ` | Schemas, tables, CTEs — not expression functions |
| `FROM emp e` then `e.` | Columns of `emp` |
| `WITH c AS (SELECT id FROM t) … c.` | CTE columns such as `id` |
| Cursor inside a nested `(SELECT … FROM dept d WHERE d.` | Inner `dept` only — outer `FROM emp` should not leak |
| Accept a function like `NVL` / `ISNULL` | Snippet with placeholders; `(` may show argument hints |

Tips:

- Suggestions are capped and prefer the **default schema** so large catalogs stay responsive.
- Switching or disconnecting a connection clears cached column metadata for completion.
- More detail for contributors: [`sql-intellisense-work-breakdown.md`](./sql-intellisense-work-breakdown.md).
