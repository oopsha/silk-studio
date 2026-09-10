import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useCloseOnAppBlur } from "@silk-studio/ui/hooks/useCloseOnAppBlur.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConnectionService } from "../../../services/connection/connectionService";
import { ConnectionTargetQuickPickService } from "../../../services/connection/connectionTargetQuickPickService";
import {
  bindingForProfile,
  formatConnectionNameLabel,
} from "../../../services/connection/connectionTargetLabel";
import { EditorConnectionBindingService } from "../../../services/connection/editorConnectionBindingService";
import { useConnectionState } from "../../../services/connection/useConnectionState";
import { useEditorConnectionBinding } from "../../../services/connection/useEditorConnectionBinding";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { formatErrorMessage } from "../../../services/formatErrorMessage";
import {
  getCreateTableDraft,
  isCreateTableDraftTab,
  updateCreateTableDraft,
} from "../../../services/connection/createTableDraftService";
import { effectiveDefaultSchema } from "../../../services/connection/connectionTypes";
import "@silk-studio/workbench/components/layout/TitleBar/OpenEditorsQuickPick/OpenEditorsQuickPick.css";
import {
  placeOverSilkEditor,
  TITLEBAR_QUICK_PICK_CLASS,
} from "@silk-studio/workbench/services/quickinput/titlebarQuickPickPlacement.ts";
import "./ConnectionTargetStatusItem.css";

type PickItem =
  | { kind: "hint"; id: string; label: string }
  | {
      kind: "profile";
      profileId: string;
      label: string;
      detail: string;
      connected: boolean;
      connecting: boolean;
    };

function isSelectable(pick: PickItem): boolean {
  return pick.kind !== "hint";
}

/** Status bar picker for which *connection* the active editor tab targets.
 * Database/schema selection is a separate picker — see DatabaseTargetStatusItem. */
function ConnectionTargetStatusItem() {
  const { t } = useI18n();
  const binding = useEditorConnectionBinding();
  const connection = useConnectionState();
  const [open, setOpen] = useState(() =>
    ConnectionTargetQuickPickService.isOpen(),
  );
  const [filter, setFilter] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [placed, setPlaced] = useState(false);
  const activeTab = EditorService.getActiveTab();
  const draftId = isCreateTableDraftTab(activeTab?.uri)
    ? activeTab?.uri
        ? activeTab.uri.slice("silk://create-table/".length)
        : null
    : null;
  const draft = draftId ? getCreateTableDraft(decodeURIComponent(draftId)) : undefined;
  const draftDriverId = draft
    ? ConnectionService.getProfile(draft.profileId)?.driverId
    : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const label = formatConnectionNameLabel(binding, {
    noConnection: t("app.connectionTarget.noConnection"),
    disconnected: t("app.connectionTarget.disconnected"),
  });

  const connected =
    Boolean(binding.profileId) &&
    ConnectionService.isConnected(binding.profileId!);
  const hasBinding = Boolean(binding.profileId);

  useEffect(() => {
    return ConnectionTargetQuickPickService.onDidChange(() => {
      const next = ConnectionTargetQuickPickService.isOpen();
      setOpen(next);
      setPlaced(false);
      if (next) {
        setFilter("");
        setFocusedIndex(0);
      }
    });
  }, []);

  const close = useCallback(() => {
    ConnectionTargetQuickPickService.hide();
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      document.documentElement.classList.remove(TITLEBAR_QUICK_PICK_CLASS);
      return;
    }

    const el = pickerRef.current;
    if (!el) return;

    const place = () => {
      if (placeOverSilkEditor(el)) setPlaced(true);
    };

    place();
    document.documentElement.classList.add(TITLEBAR_QUICK_PICK_CLASS);
    place();

    function handleResize() {
      place();
    }
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      document.documentElement.classList.remove(TITLEBAR_QUICK_PICK_CLASS);
    };
  }, [open, filter, focusedIndex]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (pickerRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open, close]);

  useCloseOnAppBlur(close, open);

  const picks = useMemo((): PickItem[] => {
    if (!open) return [];
    const query = filter.trim().toLowerCase();
    // Show every saved profile — connected or not — like DBeaver's connection
    // dropdown. Picking a disconnected one connects it (see acceptPick).
    const profiles = connection.profiles.filter((profile) => {
      if (draftDriverId && profile.driverId !== draftDriverId) return false;
      if (!query) return true;
      return (
        profile.name.toLowerCase().includes(query) ||
        profile.user.toLowerCase().includes(query)
      );
    });

    const items: PickItem[] = [];

    if (profiles.length === 0) {
      items.push({
        kind: "hint",
        id: "connections-empty",
        label: query
          ? t("app.connectionTarget.pickerNoMatch")
          : t("app.connectionTarget.pickerEmpty"),
      });
    } else {
      for (const profile of profiles) {
        items.push({
          kind: "profile",
          profileId: profile.id,
          label: profile.name,
          detail: profile.user
            ? `${profile.user} · ${profile.driverId}`
            : profile.driverId,
          connected: connection.connectedProfileIds.includes(profile.id),
          connecting: connection.connectingProfileIds.includes(profile.id),
        });
      }
    }

    return items;
  }, [
    open,
    filter,
    connection.profiles,
    connection.connectedProfileIds,
    connection.connectingProfileIds,
    draftDriverId,
    t,
  ]);

  const findSelectableIndex = useCallback(
    (from: number, delta: number): number => {
      if (picks.length === 0) return 0;
      let index = from;
      for (let step = 0; step < picks.length; step += 1) {
        index = (index + delta + picks.length) % picks.length;
        const pick = picks[index];
        if (pick && isSelectable(pick)) return index;
      }
      return from;
    },
    [picks],
  );

  useEffect(() => {
    if (picks.length === 0) {
      setFocusedIndex(0);
      return;
    }
    setFocusedIndex((current) => {
      const pick = picks[current];
      if (pick && isSelectable(pick)) {
        return Math.min(current, picks.length - 1);
      }
      for (let index = 0; index < picks.length; index += 1) {
        if (isSelectable(picks[index]!)) return index;
      }
      return 0;
    });
  }, [picks]);

  const acceptPick = useCallback(
    (pick: PickItem) => {
      if (!isSelectable(pick)) return;
      if (pick.kind !== "profile") return;

      const tab = EditorService.getActiveTab();
      close();
      if (!tab) return;

      const draftUri = isCreateTableDraftTab(tab.uri) ? tab.uri : null;
      const id = draftUri
        ? decodeURIComponent(draftUri.slice("silk://create-table/".length))
        : null;
      const activeDraft = id ? getCreateTableDraft(id) : undefined;

      if (activeDraft) {
        void (async () => {
          try {
            if (!pick.connected) await ConnectionService.connect(pick.profileId);
            const profile = ConnectionService.getProfile(pick.profileId);
            if (!profile) throw new Error("연결 정보를 찾을 수 없습니다.");
            const next = bindingForProfile(pick.profileId);
            updateCreateTableDraft(id!, {
              ...activeDraft,
              profileId: pick.profileId,
              catalogName: next.catalog,
              schemaName: next.schema ?? effectiveDefaultSchema(profile),
            });
            EditorConnectionBindingService.setBinding(tab.id, next);
          } catch (error) {
            AppNotificationService.show(
              formatErrorMessage(error, t("app.connectionTarget.connectFailed")),
              "error",
            );
          }
        })();
        return;
      }

      // Bind immediately so the status bar reflects the pick right away —
      // query execution lazily connects anyway (resolveExecutionConnection).
      EditorConnectionBindingService.setBinding(tab.id, bindingForProfile(pick.profileId));
      if (!pick.connected && !pick.connecting) {
        void ConnectionService.connect(pick.profileId).catch((error) => {
          AppNotificationService.show(formatErrorMessage(error, t("app.connectionTarget.connectFailed")), "error");
        });
      }
    },
    [close, t],
  );

  const handleInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (picks.length === 0) return;
      setFocusedIndex(findSelectableIndex(focusedIndex, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (picks.length === 0) return;
      setFocusedIndex(findSelectableIndex(focusedIndex, -1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const pick = picks[focusedIndex];
      if (!pick || !isSelectable(pick)) return;
      acceptPick(pick);
    }
  };

  const emptyHint =
    connection.profiles.length === 0
      ? t("app.connectionTarget.pickerEmpty")
      : t("app.connectionTarget.pickerNoMatch");

  const hasSelectable = picks.some(isSelectable);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="status-bar__item"
        data-connection-target-anchor
        title={t("app.connectionTarget.pickerTitle")}
        aria-label={t("app.connectionTarget.ariaLabel").replace(
          "{label}",
          label,
        )}
        aria-expanded={open}
        onClick={() => ConnectionTargetQuickPickService.toggle()}
      >
        <Codicon
          name={
            connected
              ? "database"
              : hasBinding
                ? "debug-disconnect"
                : "circle-outline"
          }
        />
        <span>{label}</span>
      </button>

      {open
        ? createPortal(
            <div
              ref={pickerRef}
              className="quick-input-widget connection-target-picker"
              role="dialog"
              aria-modal="true"
              aria-label={t("app.connectionTarget.pickerTitle")}
              style={{
                position: "fixed",
                opacity: placed ? 1 : 0,
                pointerEvents: placed ? "auto" : "none",
              }}
            >
              <div className="quick-input-header">
                <div className="quick-input-filter">
                  <input
                    ref={inputRef}
                    className="quick-input-box"
                    type="text"
                    value={filter}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={t("app.connectionTarget.pickerPlaceholder")}
                    aria-label={t("app.connectionTarget.pickerPlaceholder")}
                    onChange={(event) => setFilter(event.target.value)}
                    onKeyDown={handleInputKeyDown}
                  />
                </div>
              </div>
              <div className="quick-input-list" role="listbox">
                {!hasSelectable ? (
                  <div className="quick-input-list__empty">{emptyHint}</div>
                ) : (
                  picks.map((pick, index) => {
                    if (pick.kind === "hint") {
                      return (
                        <div
                          key={`hint-${pick.id}`}
                          className="connection-target-picker__hint"
                          role="presentation"
                        >
                          {pick.label}
                        </div>
                      );
                    }

                    const selected = pick.profileId === binding.profileId;
                    const focused = index === focusedIndex;
                    return (
                      <div
                        key={pick.profileId}
                        className={`quick-input-list-row${
                          focused ? " quick-input-list-row--focused" : ""
                        }`}
                        role="option"
                        aria-selected={focused}
                        onMouseEnter={() => setFocusedIndex(index)}
                        onClick={() => acceptPick(pick)}
                      >
                        <div className="quick-input-list-entry">
                          <span className="quick-input-list-icon" aria-hidden>
                            <Codicon
                              name={
                                selected
                                  ? "check"
                                  : pick.connecting
                                    ? "loading"
                                    : pick.connected
                                      ? "database"
                                      : "circle-outline"
                              }
                            />
                          </span>
                          <span className="quick-input-list-label connection-target-picker__label">
                            {pick.label}
                          </span>
                          <span className="connection-target-picker__detail">
                            {pick.detail}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default ConnectionTargetStatusItem;
