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

## Diagnostics

| Help menu | What it does |
| --- | --- |
| **Copy Diagnostics** | Copies a redacted support summary to the clipboard |
| **Open Log Folder** | Opens the app log directory |
| **About** | Shows product name and version |

Toasts use a polite live region so screen readers hear success/error messages.

## Smoke check (packaged build)

After installing a release build, use [`smoke-checklist.md`](./smoke-checklist.md) (launch + Settings). No database connection is required for that smoke.
