# Bundled jdbc-agent + JRE (+ session-manager-plugin, partial)

Silk DB Studio ships a **jdbc-agent** thin jar (+ `lib/` drivers) and an **Eclipse Temurin
JRE 17**, so installers can connect and run SQL **without any system Java**. It can also open
an **AWS SSM tunnel**, but — unlike the JRE — the **session-manager-plugin binary is not
auto-staged yet**; see "session-manager-plugin: known gap" below.

## Layout (inside the app package)

| Platform | Resource root | Agent | JRE | SSM plugin |
| --- | --- | --- | --- | --- |
| macOS | `Silk DB Studio.app/Contents/Resources/` | `jdbc-agent/jdbc-agent-all.jar` + `lib/` | `jre/bin/java` | not staged (see gap below) |
| Windows | next to the `.exe` | same | `jre/bin/java.exe` | not staged (see gap below) |

At runtime Rust resolves:

1. Packaged paths under Tauri `resource_dir` when present  
2. Otherwise (dev) monorepo `packages/jdbc-agent/build/libs/…`, `java` on `PATH`, and
   `session-manager-plugin`/`session-manager-plugin.exe` on `PATH`

The SSM plugin is only used by the optional AWS SSM tunnel connection feature — its absence
does not affect any other functionality (`ssm_plugin_bundled` surfaces its presence for
diagnostics, same as `agent_bundled`/`java_bundled`).

### session-manager-plugin: known gap

Unlike the JRE (a plain archive containing a portable binary), AWS only distributes the
Windows plugin as an **installer** (`SessionManagerPluginSetup.exe`, or the equivalent
`SessionManagerPlugin.zip`) that AWS's own docs say **requires Administrator rights** to run.
The actual binary this app needs, `session-manager-plugin.exe`, only exists on disk after that
installer has been run — there's no plain download of it to copy the way `stageJre()` does.

`scripts/prepare-runtime-resources.mjs`'s `stageSsmPlugin()` currently does **nothing** but log
a warning — it deliberately does not fake success by copying the installer and pretending it's
the binary. Until this is resolved (running the installer silently/elevated into a
build-controlled directory, or finding an alternative unprivileged distribution), the SSM
tunnel feature only works when **the user has separately installed the official Session
Manager plugin themselves** (the normal one-time step from AWS's docs) with its install
directory on `PATH` — the dev/PATH fallback above already covers that case, packaged builds do
not have it bundled.

## Prepare before `tauri build`

From the repo root (network required once to fetch the JRE):

```bash
node scripts/prepare-runtime-resources.mjs
```

Options:

- `--skip-jre` — stage agent only (dev convenience; **not** for release)  
- `--force-jre` — re-download even if `resources/jre` exists  

Env overrides for cross-prep (advanced):

- `SILK_JRE_OS=mac|windows|linux`  
- `SILK_JRE_ARCH=x64|aarch64`

`pnpm tauri build` in `apps/silk-db-studio` runs this script via `beforeBuildCommand`.

After staging, the script makes the JRE tree owner-writable. Temurin ships some
files (for example `*.jsa`) as read-only; if those modes are preserved into
`target/*/resources`, the next Tauri rebuild fails with `Permission denied`
when overwriting them.

**Build each OS on that OS** (or supply the matching JRE). A Mac build embeds a Mac JRE; a Windows build embeds a Windows JRE.

## Development (`tauri dev`)

Bundled resources are optional. Use a local JDK/JRE 17+ on `PATH` and:

```bash
cd packages/jdbc-agent && ./gradlew build
```

## Licensing

- JDBC drivers — [`packages/jdbc-agent/THIRD_PARTY_NOTICES.md`](../packages/jdbc-agent/THIRD_PARTY_NOTICES.md)  
- Temurin JRE 17 — GPLv2 with Classpath Exception ([Adoptium](https://adoptium.net/docs/faq/)); notice file written to `resources/jre/SILK_JRE_SOURCE.txt` when prepared  
- AWS session-manager-plugin — Apache-2.0 ([github.com/aws/session-manager-plugin](https://github.com/aws/session-manager-plugin)); not auto-staged yet (see the known gap above), so no notice file is generated for it currently

When redistributing installers, keep agent jars unmodified (thin jar + external `lib/`) and retain these notices.
