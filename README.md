# Silk Studio

Local-first monorepo for database, ERD, and web development tools.

## Workspace

- `apps/silk-db-studio` — Tauri desktop database studio and DB-specific UI
- `packages/silk-editor` — Monaco editor, editor state, and tab bar
- `packages/silk-workbench` — commands, menus, layout services, and workbench views
- `packages/silk-ui` — design tokens, fonts, icons, and shared UI hooks
- `packages/db-protocol` — Java/Rust/TypeScript agent protocol contract
- `packages/jdbc-agent` — shared Java JDBC sidecar
- `crates/silk-db-agent-client` — shared Rust process and protocol client

Dependency direction:

```text
silk-ui <- silk-editor <- silk-workbench <- silk-db-studio
                    db-protocol <- silk-db-studio
jdbc-agent <- silk-db-agent-client <- silk-db-studio (Tauri)
```

## Development

```powershell
pnpm install
cd packages/jdbc-agent
.\gradlew.bat build
cd ../..
Copy-Item apps/silk-db-studio/.env.example apps/silk-db-studio/.env.local
pnpm --filter @silk-studio/db-studio tauri:dev
```

The local `.env.local` file is ignored by Git.

