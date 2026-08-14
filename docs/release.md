# Release · updater · signing

Silk DB Studio uses **GitHub Releases** as the update feed and **Tauri updater** (`tauri-plugin-updater`) to check/install signed artifacts.

Endpoint (configured in `tauri.conf.json`):

```text
https://github.com/oopsha/silk-studio/releases/latest/download/latest.json
```

## One-time: updater signing keys (minisign)

Updater signatures are **required**. Generate a keypair on a trusted machine:

```bash
cd apps/silk-db-studio
pnpm exec tauri signer generate -w ../../.secrets/tauri-updater.key --ci -p ""
```

- **Public key** (`.key.pub`): paste the full file contents into  
  `apps/silk-db-studio/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`  
  (replace `REPLACE_AFTER_tauri_signer_generate`). Commit the pubkey in config.
- **Private key** (`.key`): store only in a password manager / CI secret.  
  **Never commit** (see `.gitignore`: `.secrets/`, `*.key`).

Local release builds that produce updater artifacts need the private key set as
`TAURI_SIGNING_PRIVATE_KEY`. Rather than setting it by hand every time, use:

```bash
pnpm --filter @silk-studio/db-studio tauri:build
```

This runs [`scripts/tauri-build-signed.mjs`](../scripts/tauri-build-signed.mjs), which
auto-loads `.secrets/tauri-updater.key` into `TAURI_SIGNING_PRIVATE_KEY` (if the env var
isn't already set) before invoking `tauri build` — no manual `$env:...` step needed as long
as the key file exists locally. If it's missing, the script warns and proceeds with an
unsigned build instead of failing.

To set the env var manually instead (e.g. for `tauri dev`, or a one-off `tauri build` call):

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw .secrets/tauri-updater.key
# optional if you set a password when generating:
# $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
```

Without the private key, `createUpdaterArtifacts: true` builds may fail when creating `.sig` files.

## Check for Updates (app)

Manage (gear) → **Check for Updates…** (`update.check`):

1. Fetches `latest.json` from GitHub Releases  
2. If newer → confirm → download/install → relaunch  
3. If up to date / no feed yet → toast message  

Dev (`tauri dev`) can run the check; install only applies to packaged builds.

## GitHub Actions secrets (slots)

Create these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Required for | Purpose |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Updater | Full contents of `.secrets/tauri-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater (if set) | Password used when generating the key; omit or empty if none |
| `APPLE_CERTIFICATE` | macOS code sign | Base64 `.p12` Developer ID Application cert |
| `APPLE_CERTIFICATE_PASSWORD` | macOS code sign | Password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | macOS code sign | e.g. `Developer ID Application: …` |
| `APPLE_ID` | Notarize | Apple ID email |
| `APPLE_PASSWORD` | Notarize | App-specific password |
| `APPLE_TEAM_ID` | Notarize | Team ID |
| `APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH` | Notarize (alt) | App Store Connect API key flow (optional alternative to Apple ID) |
| `WINDOWS_CERTIFICATE` | Authenticode | Base64 `.pfx` (optional until you distribute widely) |
| `WINDOWS_CERTIFICATE_PASSWORD` | Authenticode | Password for the `.pfx` |

**Minimum to ship updater:** `TAURI_SIGNING_PRIVATE_KEY` (+ password if any) and a valid `plugins.updater.pubkey` in `tauri.conf.json`.

OS code signing / notarize secrets are **slots** for when certificates are ready; the release workflow runs without them (unsigned OS packages, but still updater-signed if the Tauri key is present).

## Publishing a release

### Automated (tag)

1. Put pubkey in `tauri.conf.json` and secrets in GitHub.  
2. Push a version tag, e.g. `v0.1.1` (must match `tauri.conf.json` / Cargo version you intend to ship).  
3. Workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) builds macOS + Windows, uploads installers + updater artifacts, and writes `latest.json` via `tauri-apps/tauri-action`.

### Manual checklist

- [ ] Bump `version` in `apps/silk-db-studio/src-tauri/tauri.conf.json` (and Cargo package if needed)  
- [ ] `prepare-runtime-resources` / bundled JRE for **each** OS you build on  
- [ ] `TAURI_SIGNING_PRIVATE_KEY` set for the build  
- [ ] Tag / create GitHub Release with NSIS/MSI/DMG (or `.app.tar.gz`) **and** `.sig` + `latest.json`  
- [ ] Install previous version → Manage → Check for Updates → confirm upgrade  

## Platform notes

| OS | Installer | Updater bundle |
| --- | --- | --- |
| Windows | `.msi` / `-setup.exe` | same + `.sig` |
| macOS | `.app` / `.dmg` | `.app.tar.gz` + `.sig` |

Build **each OS on that OS** so the bundled Temurin JRE matches (see [`bundled-runtime.md`](./bundled-runtime.md)).

## Company network / SSL

If Node `fetch` to Adoptium fails (certificate revocation), stage JRE manually before `tauri build` (see productization / bundled-runtime notes). Updater feed uses GitHub HTTPS; corporate SSL inspection can also block update checks—use diagnostics toasts for failures.
