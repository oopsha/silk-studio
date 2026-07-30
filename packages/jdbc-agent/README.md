# jdbc-agent

Minimal Java JDBC agent for Silk Editor prototype.

## Build

```bash
cd jdbc-agent
./gradlew build
```

This creates a runnable fat jar:

`build/libs/jdbc-agent-all.jar`

## Runtime Environment Variables

- `SILK_DB_URL` (required)  
  Example: `jdbc:oracle:thin:@localhost:1521/FREEPDB1`
- `SILK_DB_USER` (required)
- `SILK_DB_PASSWORD` (required)
- `SILK_DB_QUERY_TIMEOUT_SEC` (optional, default: `30`)
- `SILK_DB_MAX_ROWS` (optional, default: `200`)

## CLI

```bash
java -jar build/libs/jdbc-agent-all.jar query.execute "select * from dual"
```

## Bundled Drivers & Licensing

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the JDBC drivers bundled in
`build/libs/lib/` and their licenses — MySQL Connector/J (GPLv2 + FOSS Exception) and MariaDB
Connector/J (LGPL-2.1-or-later) in particular need care if this agent is ever redistributed
outside this repo. PostgreSQL JDBC is BSD-2-Clause.

Desktop packaging (Tauri resources + Temurin JRE): see
[`docs/bundled-runtime.md`](../../docs/bundled-runtime.md) and run
`node scripts/prepare-runtime-resources.mjs` before `tauri build`.
