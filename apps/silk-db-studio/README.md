# Silk DB Studio

Tauri desktop application that composes the shared Silk Editor, Workbench, UI,
and DB agent packages.

From the monorepo root:

```powershell
pnpm --filter @silk-studio/db-studio build
pnpm --filter @silk-studio/db-studio tauri dev
```

Database connections are managed in the Explorer **Connections** view (connection profiles + object tree).
Session options (query timeout, auto-commit, read-only) live under **Settings → Database**.
Build `packages/jdbc-agent` before connecting or executing a query.
