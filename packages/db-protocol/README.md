# DB Protocol

Shared line-delimited JSON protocol between Silk Studio applications and the
Java JDBC agent.

Every request and response occupies one UTF-8 line. Requests contain `id`,
`method`, and `params`. Responses echo the request `id` and contain either a
`result` with `ok: true` or an `error` with `ok: false`.

Current methods:

- `agent.ping`
- `agent.shutdown`
- `connection.open`
- `query.execute`

Add metadata and DDL operations here before implementing them in an app or
agent.
