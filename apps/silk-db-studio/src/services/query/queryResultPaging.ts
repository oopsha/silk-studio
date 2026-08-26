import { isQueryResultPayload, type QueryResultPayload } from "@silk-studio/db-protocol";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { invokeJdbcCommand } from "../connection/jdbcInvoke";
import type { FilterColumnWire, SortColumnWire } from "./filterModelTranslator";

export type FetchQueryResultPageOptions = {
  binds?: Array<string | null>;
  filters?: FilterColumnWire[];
  sort?: SortColumnWire[];
};

/**
 * Re-runs `sql` (the exact statement text actually executed — any bind-parameter placeholders
 * already rewritten to positional `?`, paired with `binds`) wrapped with offset/limit pagination
 * and an optional translated AG-Grid filter, server-side (`query_execute_paged` / jdbc-agent's
 * `query.executePaged`) — backs the large-result scroll feature (5-D v2) via AG-Grid's Infinite
 * Row Model. Only ever called when the initial `query_execute` already reported `truncated: true`.
 *
 * `knownColumns` (the result's own column list) is forwarded so the agent can validate `filters`'
 * column names before embedding them in generated SQL — see `FilterSqlBuilder.java`.
 */
export async function fetchQueryResultPage(
  connectionId: string,
  sql: string,
  knownColumns: string[],
  offset: number,
  limit: number,
  options?: FetchQueryResultPageOptions,
): Promise<QueryResultPayload> {
  const queryTimeoutSec = ConfigurationService.getValue("database.queryTimeoutSec");
  const autoCommit = ConfigurationService.getValue("database.autoCommit");
  const readOnly = ConfigurationService.getValue("database.readOnly");
  const binds = options?.binds;
  const filters = options?.filters;
  const sort = options?.sort;
  const payload = await invokeJdbcCommand<unknown>(
    "query_execute_paged",
    {
      connectionId,
      sql,
      knownColumns,
      offset,
      limit,
      queryTimeoutSec,
      autoCommit,
      readOnly,
      binds: binds && binds.length > 0 ? binds : null,
      filters: filters && filters.length > 0 ? filters : null,
      sort: sort && sort.length > 0 ? sort : null,
    },
    connectionId,
  );
  if (!isQueryResultPayload(payload)) {
    throw new Error("Invalid paged query result payload from desktop bridge.");
  }
  return payload;
}
