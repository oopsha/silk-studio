# Bundled runtime resources

Populated by `scripts/prepare-runtime-resources.mjs` (not committed).

| Path | Contents |
| --- | --- |
| `jdbc-agent/` | `jdbc-agent-all.jar` + `lib/` (+ notices) |
| `jre/` | Eclipse Temurin JRE 17 for the **build host** OS/arch |
| `ssm-plugin/` | AWS `session-manager-plugin` binary (Windows/macOS build host; Linux not yet), see `docs/bundled-runtime.md` |

See [`docs/bundled-runtime.md`](../../../../docs/bundled-runtime.md).
