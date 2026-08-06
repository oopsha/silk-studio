import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "../../platform/i18n/useI18n";
import { AiAuditLogDialogService } from "../../services/ai/aiAuditLogDialogService";
import { AiAuditLogService } from "../../services/ai/aiAuditLogService";
import { formatEstimatedCostUsd } from "../../services/ai/aiAuditLogPricing";
import type { AiAuditLogEntry } from "../../services/ai/aiAuditLogTypes";
import { useAiAuditLog } from "../../services/ai/useAiAuditLog";
import { AI_PROVIDER_LABELS } from "../../services/settings/aiSettingsConstants";
import "./AiAuditLogDialog.css";

const AI_AUDIT_DISPLAY_LIMIT = 50;

function formatAuditTime(at: number): string {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return String(at);
  }
}

function formatTokenPair(entry: AiAuditLogEntry): string {
  const input =
    typeof entry.inputTokens === "number" ? String(entry.inputTokens) : "—";
  const output =
    typeof entry.outputTokens === "number" ? String(entry.outputTokens) : "—";
  if (input === "—" && output === "—") return "—";
  return `${input} / ${output}`;
}

function AiAuditLogDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => AiAuditLogDialogService.isOpen());
  const entries = useAiAuditLog();
  const visible = entries.slice(0, AI_AUDIT_DISPLAY_LIMIT);
  const totalCost = AiAuditLogService.getTotalEstimatedCostUsd();

  useEffect(() => {
    return AiAuditLogDialogService.onDidChange(() => {
      setOpen(AiAuditLogDialogService.isOpen());
    });
  }, []);

  if (!open) {
    return null;
  }

  function close() {
    AiAuditLogDialogService.close();
  }

  function handleClear(): void {
    if (entries.length === 0) return;
    if (!window.confirm(t("app.ai.auditClearConfirm"))) return;
    AiAuditLogService.clear();
  }

  function handleExport(): void {
    const blob = new Blob([AiAuditLogService.exportJson()], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `silk-ai-audit-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="ai-audit-log-dialog__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div
        className="ai-audit-log-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-audit-log-dialog-title"
      >
        <header className="ai-audit-log-dialog__header">
          <h2 id="ai-audit-log-dialog-title">{t("app.ai.auditLog")}</h2>
          <button
            type="button"
            className="ai-audit-log-dialog__close"
            aria-label={t("common.close")}
            onClick={close}
          >
            <Codicon name="close" />
          </button>
        </header>

        <div className="ai-audit-log-dialog__body">
          <p className="ai-audit-log-dialog__summary">
            {entries.length === 0
              ? t("app.ai.auditEmpty")
              : t("app.ai.auditSummary")
                  .replace("{n}", String(entries.length))
                  .replace("{cost}", formatEstimatedCostUsd(totalCost))}
          </p>
          <p className="ai-audit-log-dialog__note">{t("app.ai.auditNote")}</p>
          <div className="ai-audit-log-dialog__actions">
            <button
              type="button"
              className="ai-audit-log-dialog__button"
              disabled={entries.length === 0}
              onClick={handleExport}
            >
              {t("app.ai.auditExport")}
            </button>
            <button
              type="button"
              className="ai-audit-log-dialog__button"
              disabled={entries.length === 0}
              onClick={handleClear}
            >
              {t("app.ai.auditClear")}
            </button>
          </div>
          {visible.length > 0 ? (
            <ul className="ai-audit-log-dialog__list">
              {visible.map((entry) => (
                <li key={entry.id} className="ai-audit-log-dialog__item">
                  <div className="ai-audit-log-dialog__item-meta">
                    <span
                      className={`ai-audit-log-dialog__status ai-audit-log-dialog__status--${entry.status}`}
                    >
                      {entry.status}
                    </span>
                    <span>{formatAuditTime(entry.at)}</span>
                    <span>
                      {entry.kind === "test_connection"
                        ? t("app.ai.auditKindTest")
                        : t("app.ai.auditKindChat")}
                    </span>
                  </div>
                  <div className="ai-audit-log-dialog__item-detail">
                    {AI_PROVIDER_LABELS[entry.provider]} ·{" "}
                    {entry.model || "(model)"}
                  </div>
                  <div className="ai-audit-log-dialog__item-detail">
                    {t("app.ai.auditTokensLine")
                      .replace("{tokens}", formatTokenPair(entry))
                      .replace(
                        "{cost}",
                        formatEstimatedCostUsd(entry.estimatedCostUsd),
                      )}
                    {typeof entry.durationMs === "number"
                      ? ` · ${entry.durationMs}ms`
                      : ""}
                    {entry.errorCode ? ` · ${entry.errorCode}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {entries.length > AI_AUDIT_DISPLAY_LIMIT ? (
            <p className="ai-audit-log-dialog__note">
              {t("app.ai.auditShowingLatest").replace(
                "{n}",
                String(AI_AUDIT_DISPLAY_LIMIT),
              )}
            </p>
          ) : null}
        </div>

        <footer className="ai-audit-log-dialog__footer">
          <button
            type="button"
            className="ai-audit-log-dialog__button ai-audit-log-dialog__button--primary"
            onClick={close}
          >
            {t("common.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default AiAuditLogDialog;
