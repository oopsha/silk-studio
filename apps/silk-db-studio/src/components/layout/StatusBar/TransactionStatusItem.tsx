import { useEffect, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConnectionService } from "../../../services/connection/connectionService";
import {
  ConnectionTransactionService,
  commitConnection,
  rollbackConnection,
} from "../../../services/connection/connectionTransactionService";
import { useEditorConnectionBinding } from "../../../services/connection/useEditorConnectionBinding";
import "./TransactionStatusItem.css";

function useConnectionTransactionDirty(connectionId: string | null): boolean {
  const [dirty, setDirty] = useState(() =>
    ConnectionTransactionService.isDirty(connectionId),
  );

  useEffect(() => {
    setDirty(ConnectionTransactionService.isDirty(connectionId));
    return ConnectionTransactionService.onDidChange(() => {
      setDirty(ConnectionTransactionService.isDirty(connectionId));
    });
  }, [connectionId]);

  return dirty;
}

/** Status bar indicator + commit/rollback for the active editor's bound connection. */
function TransactionStatusItem() {
  const { t } = useI18n();
  const binding = useEditorConnectionBinding();
  const connectionId = binding.profileId;
  const dirty = useConnectionTransactionDirty(connectionId);
  const [busy, setBusy] = useState(false);

  if (!connectionId || !dirty) {
    return null;
  }

  const name = ConnectionService.getProfile(connectionId)?.name ?? connectionId;

  const handleCommit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await commitConnection(connectionId);
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await rollbackConnection(connectionId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="status-bar__transaction-group"
      title={t("app.transaction.pendingTooltip").replace("{name}", name)}
    >
      <span className="status-bar__transaction-label">
        <Codicon name="circle-filled" />
        <span>{t("app.transaction.pendingLabel")}</span>
      </span>
      <button
        type="button"
        className="status-bar__transaction-action"
        title={t("app.transaction.commitTitle").replace("{name}", name)}
        aria-label={t("app.transaction.commitTitle").replace("{name}", name)}
        disabled={busy}
        onClick={() => void handleCommit()}
      >
        <Codicon name="check" />
      </button>
      <button
        type="button"
        className="status-bar__transaction-action"
        title={t("app.transaction.rollbackTitle").replace("{name}", name)}
        aria-label={t("app.transaction.rollbackTitle").replace("{name}", name)}
        disabled={busy}
        onClick={() => void handleRollback()}
      >
        <Codicon name="discard" />
      </button>
    </div>
  );
}

export default TransactionStatusItem;
