import type { SqlParameterField, SqlParameterValue } from "./sqlParameters";

export type SqlParameterDialogRequest = {
  fields: SqlParameterField[];
  /** Prefilled values keyed by parameterValueKey. */
  initialValues: Map<string, SqlParameterValue>;
};

export type SqlParameterDialogResult =
  | { confirmed: true; values: Map<string, SqlParameterValue> }
  | { confirmed: false };

type SqlParameterDialogListener = () => void;

class SqlParameterDialogServiceImpl {
  private request: SqlParameterDialogRequest | null = null;
  private pendingResolve:
    | ((result: SqlParameterDialogResult) => void)
    | null = null;
  private readonly listeners = new Set<SqlParameterDialogListener>();
  /** Remember last submitted values across prompts in this session. */
  private readonly remembered = new Map<string, SqlParameterValue>();

  getRequest(): SqlParameterDialogRequest | null {
    return this.request;
  }

  isOpen(): boolean {
    return this.request !== null;
  }

  open(fields: SqlParameterField[]): Promise<SqlParameterDialogResult> {
    if (fields.length === 0) {
      return Promise.resolve({ confirmed: true, values: new Map() });
    }

    if (this.pendingResolve) {
      this.pendingResolve({ confirmed: false });
      this.pendingResolve = null;
    }

    const initialValues = new Map<string, SqlParameterValue>();
    for (const field of fields) {
      const key =
        field.kind === "named"
          ? `named:${field.key.toLowerCase()}`
          : `anonymous:${field.key}`;
      const remembered = this.remembered.get(key);
      initialValues.set(
        key,
        remembered
          ? { ...remembered }
          : { isNull: false, value: "" },
      );
    }

    this.request = { fields, initialValues };
    this.fireDidChange();
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  close(result: SqlParameterDialogResult): void {
    if (!this.request && !this.pendingResolve) return;
    this.request = null;
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    if (result.confirmed) {
      for (const [key, value] of result.values) {
        this.remembered.set(key, { ...value });
      }
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
