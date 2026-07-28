export type SqlTableReference = {
  schema: string | null;
  table: string;
};

const UNSUPPORTED_AFTER_TABLE =
  /\b(?:,|union|intersect|except|join|cross\s+join|inner\s+join|left\s+join|right\s+join|full\s+join|outer\s+join)\b/i;

/** Do not treat clause keywords (e.g. WHERE) as a table alias after the table name. */
const OPTIONAL_TABLE_ALIAS =
  "(?:\\s+(?:as\\s+)?(?!where\\b|group\\b|having\\b|order\\b|limit\\b|offset\\b|fetch\\b|for\\b|inner\\b|left\\b|right\\b|full\\b|cross\\b|join\\b|union\\b)[`\"\\[]?[\\w$#]+[`\"\\]]?)?";

/**
 * Extract a single base table from a simple `SELECT … FROM …` statement.
 * Returns null for joins, unions, subqueries, or non-SELECT statements.
 */
export function parseSingleTableFromSelect(sql: string): SqlTableReference | null {
  const normalized = sql.trim().replace(/;\s*$/, "");
  if (!/^\s*select\b/i.test(normalized)) {
    return null;
  }
  if (/\bunion\b|\bintersect\b|\bexcept\b/i.test(normalized)) {
    return null;
  }

  const fromMatch = normalized.match(/\bfrom\b/i);
  if (!fromMatch || fromMatch.index === undefined) {
    return null;
  }

  let rest = normalized.slice(fromMatch.index + fromMatch[0].length).trim();
  if (!rest || rest.startsWith("(")) {
    return null;
  }

  const qualifiedPattern = new RegExp(
    `^([\\"\`\\[]?)([\\w$#]+)\\1\\s*\\.\\s*([\\"\`\\[]?)([\\w$#]+)\\3${OPTIONAL_TABLE_ALIAS}`,
    "i",
  );
  const qualifiedMatch = rest.match(qualifiedPattern);
  if (qualifiedMatch) {
    const remainder = rest.slice(qualifiedMatch[0].length).trim();
    if (!isAllowedTableTail(remainder)) {
      return null;
    }
    return {
      schema: qualifiedMatch[2],
      table: qualifiedMatch[4],
    };
  }

  const barePattern = new RegExp(
    `^([\\"\`\\[]?)([\\w$#]+)\\1${OPTIONAL_TABLE_ALIAS}`,
    "i",
  );
  const bareMatch = rest.match(barePattern);
  if (!bareMatch) {
    return null;
  }

  const remainder = rest.slice(bareMatch[0].length).trim();
  if (!isAllowedTableTail(remainder)) {
    return null;
  }

  return {
    schema: null,
    table: bareMatch[2],
  };
}

function isAllowedTableTail(remainder: string): boolean {
  if (!remainder) {
    return true;
  }
  if (UNSUPPORTED_AFTER_TABLE.test(remainder)) {
    return false;
  }
  return /^\s*(where|group\s+by|having|order\s+by|limit|offset|fetch|for\s+update)\b/i.test(
    remainder,
  );
}
