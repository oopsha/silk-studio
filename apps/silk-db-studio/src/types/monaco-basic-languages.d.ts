declare module "monaco-editor/esm/vs/basic-languages/sql/sql.js" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage & {
    keywords: string[];
  };
}

declare module "monaco-editor/esm/vs/basic-languages/mysql/mysql.js" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage & {
    keywords: string[];
  };
}

declare module "monaco-editor/esm/vs/basic-languages/pgsql/pgsql.js" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage & {
    keywords: string[];
  };
}
