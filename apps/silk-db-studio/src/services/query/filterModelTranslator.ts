import {
  isCombinedFilterModel,
  type ISimpleFilterModel,
  type SortModelItem,
} from "ag-grid-community";

/** One filter condition in the agent's own wire format — shared across all 4 dialects. */
export type FilterConditionWire = {
  type: string;
  value?: string | null;
  value2?: string | null;
};

/** One column's filter (a single condition, or several joined by AND/OR). */
export type FilterColumnWire = {
  column: string;
  logic?: "AND" | "OR";
  conditions: FilterConditionWire[];
};

/**
 * AG-Grid filter `type` values this grid can actually produce (it only ever configures
 * `agTextColumnFilter`, see `QueryResultGrid.tsx`) mapped 1:1 to the agent's own vocabulary —
 * kept as an explicit allowlist so an unrecognized/future AG-Grid type is dropped rather than
 * forwarded as an unvalidated string into SQL generation.
 */
const SUPPORTED_TYPES = new Set([
  "contains",
  "notContains",
  "equals",
  "notEqual",
  "startsWith",
  "endsWith",
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "inRange",
  "blank",
  "notBlank",
]);

function toWireValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  return String(raw);
}

function translateSingleCondition(model: ISimpleFilterModel): FilterConditionWire | null {
  const type = model.type ?? null;
  if (!type || !SUPPORTED_TYPES.has(type)) return null;
  if (type === "blank" || type === "notBlank") {
    return { type };
  }
  const record = model as unknown as Record<string, unknown>;
  if (type === "inRange") {
    return {
      type,
      value: toWireValue(record.filter ?? record.dateFrom),
      value2: toWireValue(record.filterTo ?? record.dateTo),
    };
  }
  return { type, value: toWireValue(record.filter ?? record.dateFrom) };
}

/**
 * Translates AG-Grid's `filterModel` (from `api.getFilterModel()` or an `IGetRowsParams`) into
 * the agent's flat, versioned wire format — see `FilterSqlBuilder.java` for how it becomes SQL.
 * `knownColumns` (the result's own column list) gates which column names are ever forwarded —
 * this is the "never trust a client-supplied identifier" boundary for the generated WHERE clause,
 * not just a correctness nicety.
 */
export function translateFilterModel(
  filterModel: Record<string, unknown>,
  knownColumns: string[],
): FilterColumnWire[] {
  const knownSet = new Set(knownColumns);
  const result: FilterColumnWire[] = [];
  for (const [column, rawModel] of Object.entries(filterModel)) {
    if (!knownSet.has(column) || !rawModel || typeof rawModel !== "object") {
      continue;
    }
    const model = rawModel as ISimpleFilterModel;
    if (isCombinedFilterModel(model)) {
      const conditions = model.conditions
        .map(translateSingleCondition)
        .filter((condition): condition is FilterConditionWire => condition != null);
      if (conditions.length > 0) {
        result.push({ column, logic: model.operator === "OR" ? "OR" : "AND", conditions });
      }
      continue;
    }
    const condition = translateSingleCondition(model);
    if (condition) {
      result.push({ column, conditions: [condition] });
    }
  }
  return result;
}

/** One column's sort direction in the agent's own wire format. */
export type SortColumnWire = { column: string; direction: "asc" | "desc" };

/**
 * Translates AG-Grid's `sortModel` (from an `IGetRowsParams`) into the agent's wire format —
 * `colId` is validated against `knownColumns` for the same reason as `translateFilterModel`'s
 * column names (it becomes a raw, quoted identifier in the generated ORDER BY).
 */
export function translateSortModel(
  sortModel: SortModelItem[],
  knownColumns: string[],
): SortColumnWire[] {
  const knownSet = new Set(knownColumns);
  return sortModel
    .filter((item) => knownSet.has(item.colId) && (item.sort === "asc" || item.sort === "desc"))
    .map((item) => ({ column: item.colId, direction: item.sort }));
}
