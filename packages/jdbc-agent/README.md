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
`build/libs/lib/` and their licenses — MySQL Connector/J in particular is GPLv2 (+ FOSS
Exception), which needs care if this agent is ever redistributed outside this repo.
