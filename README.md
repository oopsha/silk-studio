<img src="apps/silk-db-studio/src-tauri/icons/icon.png" width="72" align="left" alt="" />

# Silk Studio

**AI-native database studio** — a monorepo for **Silk DB Studio**, a desktop DB client for Oracle, PostgreSQL, MySQL, MariaDB, and SQL Server, plus its surrounding tooling.

<br clear="left"/>

[![CI](https://github.com/oopsha/silk-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/oopsha/silk-studio/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/oopsha/silk-studio?include_prereleases&label=release)](https://github.com/oopsha/silk-studio/releases)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-informational)

> ⚠️ **Beta** — currently validated through real-world use on SQL Server / Oracle. PostgreSQL / MySQL / MariaDB have completed basic verification (connect, query, browse objects) and are still gathering feedback.

## Download

- **[silkstudio.co.kr →](https://silkstudio.co.kr)** — includes per-OS install guidance
- **[GitHub Releases →](https://github.com/oopsha/silk-studio/releases)** (Windows `.exe`/`.msi`, macOS `.dmg`, arm64/x64 each)

Installers bundle **jdbc-agent** and an **Eclipse Temurin JRE 17**, so no system Java install is needed.

## Documentation

- **Readme**: [English](README.md) · [한국어](README.ko.md)
- **User Guide**: [English](docs/user-guide.md) · [한국어](docs/user-guide.ko.md)

## Features

| Feature | Description |
| --- | --- |
| AI assistant (BYOK) | Generate SQL from natural language, review a diff before running, audit call cost/tokens |
| PL/SQL snapshot · diff · rollback | A local snapshot on every save of a procedure/function/trigger; review the diff, roll back instantly |
| Safe UPDATE | Blocks UPDATE on tables without a primary key; previews affected rows before running |
| Server-side paging | Browse large results with server paging/filtering/sorting; edit values right in the grid |
| Multi-session | Each editor tab keeps its own connection and results; sessions restore after restart (Hot Exit) |
| Search across connections | `Ctrl+Shift+O` searches tables/views/procedures across every connected profile |
| SSM & SSH tunnels | Built-in AWS SSM port forwarding and SSH jump hosts to reach databases on private networks |
| Zero-dependency runtime | Bundled JDBC agent + JRE — connect right away, nothing to install separately |

## Workspace

- `apps/silk-db-studio` — the Tauri desktop DB studio and its DB-specific UI
- `packages/silk-editor` — Monaco editor, editor state, tab bar
- `packages/silk-workbench` — commands, menus, layout services, workbench views
- `packages/silk-ui` — design tokens, fonts, icons, shared UI hooks
- `packages/db-protocol` — Java/Rust/TypeScript agent protocol contracts
- `packages/jdbc-agent` — the shared Java JDBC sidecar
- `crates/silk-db-agent-client` — the shared Rust process and protocol client

Dependency direction:

```text
silk-ui <- silk-editor <- silk-workbench <- silk-db-studio
                    db-protocol <- silk-db-studio
jdbc-agent <- silk-db-agent-client <- silk-db-studio (Tauri)
```

## Development

Requirements: **Node.js 22+**, **pnpm 11** (`package.json#packageManager` — Corepack recommended).

```powershell
corepack enable
pnpm install
cd packages/jdbc-agent
.\gradlew.bat build
cd ../..
pnpm --filter @silk-studio/db-studio tauri dev
```

On first launch, use the **Connections** icon in the left Activity Bar → **New Connection** (or the **Connection → New Connection** menu) to create a profile and connect.
