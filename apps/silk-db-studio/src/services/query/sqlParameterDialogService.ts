import type { SqlParameterField, SqlParameterValue } from "./sqlParameters";
import {
  fingerprintSql,
  loadRememberedParameterValues,
  rememberParameterValues,
} from "./sqlParameterMemoryStorage";

export type SqlParameterDialogRequest = {
  fields: SqlParameterField[];
  /** Prefilled values keyed by parameterValueKey. */
  initialValues: Map<string, SqlParameterValue>;
  /** SQL fingerprint used for anonymous-parameter memory (null = named-only). */
  sqlFingerprint: string | null;
};

export type SqlParameterDialogResult =
  | { confirmed: true; values: Map<string, SqlParameterValue> }
  | { confirmed: false };

export type SqlParameterDialogOpenOptions = {
  /** Original SQL — used to scope remembered `?` values per statement. */
  sql?: string;
};

type SqlParameterDialogListener = () => void;

class SqlParameterDialogServiceImpl {
  private request: SqlParameterDialogRequest | null = null;
  private pendingResolve:
    | ((result: SqlParameterDialogResult) => void)
    | null = null;
  private readonly listeners = new Set<SqlParameterDialogListener>();

  getRequest(): SqlParameterDialogRequest | null {
    return this.request;
  }

  isOpen(): boolean {
    return this.request !== null;
  }

  open(
    fields: SqlParameterField[],
    options?: SqlParameterDialogOpenOptions,
  ): Promise<SqlParameterDialogResult> {
    if (fields.length === 0) {
      return Promise.resolve({ confirmed: true, values: new Map() });
    }

    if (this.pendingResolve) {
      this.pendingResolve({ confirmed: false });
      this.pendingResolve = null;
    }

    const hasAnonymous = fields.some((field) => field.kind === "anonymous");
    const sqlFingerprint =
      hasAnonymous && options?.sql ? fingerprintSql(options.sql) : null;

    const initialValues = loadRememberedParameterValues(fields, sqlFingerprint);

    this.request = { fields, initialValues, sqlFingerprint };
    this.fireDidChange();
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(result: SqlParameterDialogResult): void {
    if (!this.request && !this.pendingResolve) return;
    const openRequest = this.request;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    if (result.confirmed && openRequest) {
      rememberParameterValues(
        openRequest.fields,
        result.values,
        openRequest.sqlFingerprint,
      );
    }
    this.fireDidChange();
    resolve?.(result);
  }

  onDidChange(listener: SqlParameterDialogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const SqlParameterDialogService = new SqlParameterDialogServiceImpl();
