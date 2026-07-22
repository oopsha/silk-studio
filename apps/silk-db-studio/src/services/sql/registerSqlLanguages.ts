import type { Monaco } from "@monaco-editor/react";
import type { languages } from "monaco-editor";
import {
  conf as sqlConf,
  language as sqlLanguage,
} from "monaco-editor/esm/vs/basic-languages/sql/sql.js";
import {
  conf as mysqlConf,
  language as mysqlLanguage,
} from "monaco-editor/esm/vs/basic-languages/mysql/mysql.js";
import {
  conf as pgsqlConf,
  language as pgsqlLanguage,
} from "monaco-editor/esm/vs/basic-languages/pgsql/pgsql.js";

type KeywordLanguage = languages.IMonarchLanguage & {
  keywords: string[];
};

const ORACLE_EXTRA_KEYWORDS = [
  "CONNECT",
  "DECODE",
  "DUAL",
  "MERGE",
  "MINUS",
  "NVL",
  "NVL2",
  "PARTITION",
  "PRIOR",
  "ROWNUM",
  "ROWID",
  "SEQUENCE",
  "START",
  "SYSDATE",
  "SYSTIMESTAMP",
  "TABLESPACE",
  "TRIGGER",
  "VARCHAR2",
  "NUMBER",
  "CLOB",
  "BLOB",
  "RAW",
  "WITHIN",
];

const TSQL_EXTRA_KEYWORDS = [
  "TOP",
  "NOLOCK",
  "HOLDLOCK",
  "UPDLOCK",
  "ROWLOCK",
  "IDENTITY",
  "OUTPUT",
  "MERGE",
  "TRY",
  "CATCH",
  "THROW",
  "GO",
  "ISNULL",
  "GETDATE",
  "GETUTCDATE",
  "NVARCHAR",
  "DATETIME2",
  "UNIQUEIDENTIFIER",
  "CLUSTERED",
  "NONCLUSTERED",
  "INCLUDE",
  "OFFSET",
  "FETCH",
  "NEXT",
  "ONLY",
  "APPLY",
  "PIVOT",
  "UNPIVOT",
];

let registered = false;

function languageAlreadyRegistered(monaco: Monaco, id: string): boolean {
  return monaco.languages.getLanguages().some((language) => language.id === id);
}

function ensureLanguage(
  monaco: Monaco,
  id: string,
  aliases: string[],
  conf: languages.LanguageConfiguration,
  language: KeywordLanguage,
  extraKeywords: string[] = [],
): void {
  if (!languageAlreadyRegistered(monaco, id)) {
    monaco.languages.register({ id, aliases, extensions: [".sql"] });
  }
  monaco.languages.setLanguageConfiguration(id, conf);
  const provider = {
    ...language,
    keywords: [...language.keywords, ...extraKeywords],
  } as languages.IMonarchLanguage;
  monaco.languages.setMonarchTokensProvider(id, provider);
}

/**
 * Ensures dialect SQL languages exist for Monaco highlighting.
 * Eagerly wires tokens for built-in `sql` / `mysql` / `pgsql` and adds
 * PL/SQL, T-SQL, and MariaDB.
 */
export function registerSqlLanguages(monaco: Monaco): void {
  if (registered) return;
  registered = true;

  ensureLanguage(monaco, "sql", ["SQL"], sqlConf, sqlLanguage);
  ensureLanguage(monaco, "mysql", ["MySQL"], mysqlConf, mysqlLanguage);
  ensureLanguage(
    monaco,
    "pgsql",
    ["PostgreSQL", "Postgres"],
    pgsqlConf,
    pgsqlLanguage,
  );
  ensureLanguage(
    monaco,
    "plsql",
    ["PL/SQL", "Oracle SQL"],
    sqlConf,
    sqlLanguage,
    ORACLE_EXTRA_KEYWORDS,
  );
  ensureLanguage(
    monaco,
    "tsql",
    ["T-SQL", "Transact-SQL", "SQL Server"],
    sqlConf,
    sqlLanguage,
    TSQL_EXTRA_KEYWORDS,
  );
  ensureLanguage(monaco, "mariadb", ["MariaDB"], mysqlConf, mysqlLanguage);
}
