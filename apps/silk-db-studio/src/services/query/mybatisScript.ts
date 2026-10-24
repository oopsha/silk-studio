import { parameterValueKey, type SqlParameterField, type SqlParameterValue, type SqlParameterOccurrence } from "./sqlParameters";

const tagPattern = /<!\[CDATA\[[\s\S]*?\]\]>|<\/?(?:script|if|choose|when|otherwise|where|trim|set|bind|foreach|include)\b(?:"[^"]*"|'[^']*'|[^'">])*\/?>/gi;

export function isMybatisScript(sql: string): boolean {
  return /<\/?(?:script|if|choose|when|otherwise|where|trim|set|bind|foreach|include)\b|[#\$]\{/i.test(sql);
}

export function mergeMybatisParameters(sql: string, occurrences: SqlParameterOccurrence[], values: ReadonlyMap<string, SqlParameterValue>) {
  const parameters = mybatisParameterValues(collectMybatisFields(sql), values);
  let rewritten = "";
  let cursor = 0;
  for (const occurrence of occurrences) {
    const original = sql.slice(occurrence.start, occurrence.end);
    rewritten += sql.slice(cursor, occurrence.start);
    if (/^[#$]\{/.test(original)) rewritten += original;
    else {
      const key = `__silk_bind_${occurrence.start}`;
      const value = values.get(parameterValueKey(occurrence.kind, occurrence.key));
      parameters[key] = value?.isNull ? null : value?.value ?? "";
      rewritten += `#{${key}}`;
    }
    cursor = occurrence.end;
  }
  return { sql: wrapMybatisScript(rewritten + sql.slice(cursor)), parameters };
}

/** Preserve XML instructions while protecting ordinary SQL operators and comments as text. */
export function wrapMybatisScript(sql: string): string {
  // A copied mapper statement is a container, not part of the SQL sent to JDBC.
  sql = sql.replace(/^\s*<(select|insert|update|delete)\b(?:"[^"]*"|'[^']*'|[^'">])*\s*>([\s\S]*)<\/\1>\s*$/i, "$2");
  let result = "";
  let cursor = 0;
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const match of sql.matchAll(tagPattern)) {
    result += escape(sql.slice(cursor, match.index)) + match[0];
    cursor = match.index! + match[0].length;
  }
  result += escape(sql.slice(cursor));
  return /^\s*<script\b/i.test(result) ? result.trim() : `<script>${result}</script>`;
}

export function collectMybatisFields(sql: string): SqlParameterField[] {
  if (/<(?:foreach|include)\b/i.test(sql)) {
    throw new Error("MyBatis foreach(배열 입력), include(외부 SQL 참조)는 아직 지원하지 않습니다.");
  }
  const fields = new Map<string, SqlParameterField>();
  const localNames = new Set<string>(["_parameter", "_databaseId"]);
  for (const match of sql.matchAll(/<bind\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi)) localNames.add(match[1]);
  const add = (key: string) => {
    if (!localNames.has(key.split(".")[0]) && !fields.has(key)) fields.set(key, { kind: "named", key, label: key });
  };
  for (const match of sql.matchAll(/[#\$]\{\s*([\w.]+)(?:\s*,[^}]*)?\s*\}/g)) add(match[1]);
  const reserved = new Set(["null", "true", "false", "and", "or", "not", "eq", "neq", "ne", "gt", "gte", "ge", "lt", "lte", "le", "in", "instanceof", "new"]);
  for (const tag of sql.matchAll(tagPattern)) {
    if (tag[0].startsWith("<![CDATA[")) continue;
    for (const attr of tag[0].matchAll(/\b(?:test|value)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      const expression = (attr[2] ?? attr[3]).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      const bare = expression.replace(/'[^']*'|"[^"]*"/g, " ");
      for (const token of bare.matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)) {
        const index = token.index!;
        let key = token[0];
        if (/^\s*\(/.test(bare.slice(index + key.length))) {
          const lastDot = key.lastIndexOf(".");
          if (lastDot < 0) continue;
          key = key.slice(0, lastDot);
        }
        if (!reserved.has(key)) add(key);
      }
    }
  }
  // A property input constructs its parent object, so a separate parent JSON input is redundant.
  return [...fields.values()].filter(field => ![...fields.keys()].some(key => key.startsWith(`${field.key}.`)));
}

export function mybatisParameterValues(fields: SqlParameterField[], values: ReadonlyMap<string, SqlParameterValue>): Record<string, unknown> {
  const parameters: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const value = values.get(parameterValueKey(field.kind, field.key));
    // Plain entries stay strings; JSON objects/arrays and booleans support OGNL properties/flags.
    let parsed: unknown = value?.isNull ? null : value?.value ?? "";
    if (typeof parsed === "string" && /^(?:true|false|\{|\[)/.test(parsed.trim())) {
      try { parsed = JSON.parse(parsed); } catch { /* Keep ordinary text as text. */ }
    }
    const path = field.key.split(".");
    let target = parameters;
    for (const segment of path.slice(0, -1)) {
      target[segment] ??= Object.create(null);
      target = target[segment] as Record<string, unknown>;
    }
    target[path[path.length - 1]] = parsed;
  }
  return parameters;
}
