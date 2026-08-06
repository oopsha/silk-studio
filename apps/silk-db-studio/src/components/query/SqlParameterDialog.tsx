import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import {
  SqlParameterDialogService,
} from "../../services/query/sqlParameterDialogService";
import {
  parameterValueKey,
  type SqlParameterValue,
} from "../../services/query/sqlParameters";
import "../connections/ExplorerObjectMutationDialog.css";
import "./SqlParameterDialog.css";

function SqlParameterDialog() {
  const { t } = useI18n();
  const [request, setRequest] = useState(() =>
    SqlParameterDialogService.getRequest(),
  );
  const [draft, setDraft] = useState<Map<string, SqlParameterValue>>(
    () => new Map(),
  );
  const valueInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    return SqlParameterDialogService.onDidChange(() => {
      const next = SqlParameterDialogService.getRequest();
      setRequest(next);
      if (next) {
        setDraft(new Map(next.initialValues));
      } else {
        setDraft(new Map());
      }
    });
  }, []);

  const fields = request?.fields ?? [];
  const canSubmit = useMemo(() => fields.length > 0, [fields.length]);
  const firstEnabledIndex = useMemo(() => {
    for (let i = 0; i < fields.length; i += 1) {
      const field = fields[i]!;
      const mapKey = parameterValueKey(field.kind, field.key);
      if (!(draft.get(mapKey)?.isNull ?? false)) {
        return i;
      }
    }
    return 0;
  }, [fields, draft]);

  useEffect(() => {
    valueInputRefs.current = valueInputRefs.current.slice(0, fields.length);
  }, [fields.length]);

  if (!request) {
    return null;
  }

  function close() {
    SqlParameterDialogService.close({ confirmed: false });
  }

  function confirm() {
    if (!canSubmit) return;
    SqlParameterDialogService.close({
      confirmed: true,
      values: new Map(draft),
    });
  }

  function updateField(
    kind: "named" | "anonymous",
    key: string,
    patch: Partial<SqlParameterValue>,
  ) {
    const mapKey = parameterValueKey(kind, key);
    setDraft((prev) => {
      const next = new Map(prev);
      const current = next.get(mapKey) ?? { isNull: false, value: "" };
      next.set(mapKey, { ...current, ...patch });
      return next;
    });
  }

  function isValueEnabled(index: number): boolean {
    const field = fields[index];
    if (!field) return false;
    const mapKey = parameterValueKey(field.kind, field.key);
    const entry = draft.get(mapKey);
    return !(entry?.isNull ?? false);
  }

  function focusValueAt(index: number): void {
    const input = valueInputRefs.current[index];
    if (!input || input.disabled) return;
    input.focus();
    input.select();
  }

  function findEnabledIndex(
    from: number,
    direction: 1 | -1,
  ): number | null {
    if (fields.length === 0) return null;
    for (let step = 1; step <= fields.length; step += 1) {
      const next =
        (from + direction * step + fields.length * 10) % fields.length;
      if (isValueEnabled(next)) {
        return next;
      }
    }
    return null;
  }

  function handleValueKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    index: number,
  ): void {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      confirm();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      for (let i = index + 1; i < fields.length; i += 1) {
        if (isValueEnabled(i)) {
          focusValueAt(i);
          return;
        }
      }
      confirm();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = findEnabledIndex(index, 1);
      if (next !== null) focusValueAt(next);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = findEnabledIndex(index, -1);
      if (prev !== null) focusValueAt(prev);
    }
  }

  return (
    <div
      className="explorer-mutation-dialog__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div
        className="explorer-mutation-dialog sql-parameter-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sql-parameter-dialog-title"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            confirm();
          }
        }}
      >
        <header className="explorer-mutation-dialog__header">
          <h2 id="sql-parameter-dialog-title">
            {t("app.query.parametersTitle")}
          </h2>
          <button
            type="button"
            className="explorer-mutation-dialog__close"
            aria-label={t("common.close")}
            onClick={close}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="explorer-mutation-dialog__body">
          <p className="explorer-mutation-dialog__summary">
            {t("app.query.parametersSummary")}
          </p>
          <p className="explorer-mutation-dialog__hint">
            {t("app.query.parametersExecuteHint")}
          </p>

          <div className="sql-parameter-dialog__table" role="table">
            <div className="sql-parameter-dialog__row sql-parameter-dialog__row--head" role="row">
              <div role="columnheader">{t("app.query.parametersName")}</div>
              <div role="columnheader">{t("app.query.parametersValue")}</div>
              <div role="columnheader">{t("app.query.parametersNull")}</div>
            </div>
            {fields.map((field, index) => {
              const mapKey = parameterValueKey(field.kind, field.key);
              const entry = draft.get(mapKey) ?? {
                isNull: false,
                value: "",
              };
              return (
                <div
                  key={mapKey}
                  className="sql-parameter-dialog__row"
                  role="row"
                >
                  <div
                    className="sql-parameter-dialog__name"
                    role="cell"
                    title={field.label}
                  >
                    {field.label}
                  </div>
                  <div role="cell">
                    <input
                      ref={(node) => {
                        valueInputRefs.current[index] = node;
                      }}
                      className="explorer-mutation-dialog__input sql-parameter-dialog__input"
                      type="text"
                      value={entry.value}
                      disabled={entry.isNull}
                      autoFocus={index === firstEnabledIndex}
                      onChange={(event) =>
                        updateField(field.kind, field.key, {
                          value: event.target.value,
                        })
                      }
                      onKeyDown={(event) => handleValueKeyDown(event, index)}
                    />
                  </div>
                  <div
                    className="sql-parameter-dialog__null"
                    role="cell"
                  >
                    <input
                      type="checkbox"
                      checked={entry.isNull}
                      aria-label={`${field.label} NULL`}
                      onChange={(event) =>
                        updateField(field.kind, field.key, {
                          isNull: event.target.checked,
                        })
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="explorer-mutation-dialog__footer">
          <button
            type="button"
            className="explorer-mutation-dialog__button"
            onClick={close}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="explorer-mutation-dialog__button explorer-mutation-dialog__button--primary"
            disabled={!canSubmit}
            onClick={confirm}
          >
            {t("common.execute")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default SqlParameterDialog;
