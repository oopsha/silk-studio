# Desktop smoke checklist (manual)

Playwright CI covers the **web shell** (vite preview): main window chrome + Settings open.
Use this list for **packaged Tauri builds** (installer / `.app` / portable) where WebDriver is not in CI yet.

Do **not** require a live JDBC connection for this smoke.

## Before you start

- Build or download a release/dev bundle for the OS under test
- Fresh profile optional (delete app config only if investigating persistence bugs)

## Checklist

### macOS

- [ ] App launches without crash dialog
- [ ] Main window shows Activity Bar + title bar / workbench chrome
- [ ] Activity Bar → **Manage** (gear) → **Settings** opens Settings editor
- [ ] Appearance category is visible; close Settings tab / window as usual
- [ ] Quit from menu or Dock; relaunch once (no hang on second start)

### Windows

- [ ] Installer or portable binary starts
- [ ] Main window shows Activity Bar + workbench chrome
- [ ] Activity Bar → **Manage** → **Settings** opens Settings editor
- [ ] Appearance category is visible
- [ ] Exit and start again once

## Out of scope (not smoke)

- Connecting to a database
- Running queries / PL/SQL compile
- AI provider calls
- Updater against a real GitHub release (covered by release process)

## Related

- Automated web smoke: `pnpm build:web` → `pnpm test:e2e:install` → `pnpm test:e2e`
- CI job: `.github/workflows/ci.yml` → `e2e` (macOS + Windows)
- Corporate TLS intercept: if `playwright install` fails with certificate errors, retry with `NODE_TLS_REJECT_UNAUTHORIZED=0` (dev machine only) or run smoke on a network without MITM.
