# Bundled jdbc-agent + JRE + session-manager-plugin

Silk DB Studio ships a **jdbc-agent** thin jar (+ `lib/` drivers), an **Eclipse Temurin
JRE 17**, and (Windows builds) the **AWS session-manager-plugin** binary, so installers can
connect and run SQL — including through an AWS SSM tunnel — **without any system Java, AWS
CLI, or manually-installed SSM plugin**.

## Layout (inside the app package)

| Platform | Resource root | Agent | JRE | SSM plugin |
| --- | --- | --- | --- | --- |
| macOS | `Silk DB Studio.app/Contents/Resources/` | `jdbc-agent/jdbc-agent-all.jar` + `lib/` | `jre/bin/java` | not staged yet (V2, see below) |
| Windows | next to the `.exe` | same | `jre/bin/java.exe` | `ssm-plugin/session-manager-plugin.exe` |

At runtime Rust resolves:

1. Packaged paths under Tauri `resource_dir` when present  
2. Otherwise (dev) monorepo `packages/jdbc-agent/build/libs/…`, `java` on `PATH`, and
   `session-manager-plugin`/`session-manager-plugin.exe` on `PATH`

The SSM plugin is only used by the optional AWS SSM tunnel connection feature — its absence
does not affect any other functionality (`ssm_plugin_bundled` surfaces its presence for
diagnostics, same as `agent_bundled`/`java_bundled`).

### session-manager-plugin staging (Windows)

`SessionManagerPlugin.zip` looks like an installer package (it ships `install.bat` /
`uninstall.bat`), but `install.bat` only does two things once you read it: copy
`package.zip`'s contents into `%PROGRAMFILES%`, and register a Windows service. `package.zip`
itself is a **plain, unprivileged zip** containing the actual portable
`bin/session-manager-plugin.exe`. Since Silk spawns the plugin as an ad-hoc per-tunnel
subprocess (it doesn't need or want the Windows service), `stageSsmPlugin()` in
`scripts/prepare-runtime-resources.mjs` downloads `SessionManagerPlugin.zip`, extracts
`package.zip` directly, and copies the binary + license notices into `resources/ssm-plugin/` —
no installer execution, no Administrator rights, same unprivileged shape as `stageJre()`.

macOS/Linux staging is not implemented yet (V1 is Windows-only for the SSM tunnel feature); the
`PATH` fallback above covers a locally-installed plugin on those platforms in dev.

## Prepare before `tauri build`

From the repo root (network required once to fetch the JRE):

```bash
node scripts/prepare-runtime-resources.mjs
```

Options:

- `--skip-jre` — stage agent only (dev convenience; **not** for release)  
- `--force-jre` — re-download even if `resources/jre` exists  
- `--force-ssm-plugin` — re-download even if `resources/ssm-plugin` exists  

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
- AWS session-manager-plugin — Apache-2.0 ([github.com/aws/session-manager-plugin](https://github.com/aws/session-manager-plugin)); notice file written to `resources/ssm-plugin/SILK_SSM_PLUGIN_SOURCE.txt` when prepared (Windows builds)

When redistributing installers, keep agent jars unmodified (thin jar + external `lib/`) and retain these notices.
