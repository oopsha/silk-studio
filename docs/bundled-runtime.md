# Bundled jdbc-agent + JRE

Silk DB Studio ships a **jdbc-agent** thin jar (+ `lib/` drivers) and an **Eclipse Temurin JRE 17** so installers can connect and run SQL **without a system Java**.

## Layout (inside the app package)

| Platform | Resource root | Agent | JRE |
| --- | --- | --- | --- |
| macOS | `Silk DB Studio.app/Contents/Resources/` | `jdbc-agent/jdbc-agent-all.jar` + `lib/` | `jre/bin/java` |
| Windows | next to the `.exe` | same | `jre/bin/java.exe` |

At runtime Rust resolves:

1. Packaged paths under Tauri `resource_dir` when present  
2. Otherwise (dev) monorepo `packages/jdbc-agent/build/libs/…` and `java` on `PATH`

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

When redistributing installers, keep agent jars unmodified (thin jar + external `lib/`) and retain these notices.
