/**
 * Extract SQL from assistant markdown. Prefer ```sql fences; fall back to
 * unlabeled fences that look like SQL; never invent SQL from prose.
 */
const FENCED_BLOCK =
  /```([^\n`]*)\n([\s\S]*?)```/g;

const SQL_LOOKS_LIKE =
  /^\s*(with|select|insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|begin|declare|call|exec|explain|analyze|show|describe|desc|use|set)\b/i;

function normalizeFenceLanguage(raw: string): string {
  return raw.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
}

function looksLikeSql(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  return SQL_LOOKS_LIKE.test(trimmed);
}

export function extractSqlFromMarkdown(markdown: string): string[] {
  const text = markdown ?? "";
  if (!text.trim()) return [];

  const sqlTagged: string[] = [];
  const unlabeledSql: string[] = [];

  for (const match of text.matchAll(FENCED_BLOCK)) {
    const language = normalizeFenceLanguage(match[1] ?? "");
    const body = (match[2] ?? "").trim();
    if (!body) continue;

    if (language === "sql" || language === "plsql" || language === "mysql") {
      sqlTagged.push(body);
      continue;
    }

    if (!language && looksLikeSql(body)) {
      unlabeledSql.push(body);
    }
  }

  if (sqlTagged.length > 0) return sqlTagged;
  if (unlabeledSql.length > 0) return unlabeledSql;
  return [];
}
