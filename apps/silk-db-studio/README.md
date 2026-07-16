# Silk DB Studio

Tauri desktop application that composes the shared Silk Editor, Workbench, UI,
and DB agent packages.

From the monorepo root:

```powershell
pnpm --filter @silk-studio/db-studio build
pnpm --filter @silk-studio/db-studio tauri:dev
```

JDBC credentials belong in this directory's ignored `.env.local` file. Build
`packages/jdbc-agent` before executing a query.
