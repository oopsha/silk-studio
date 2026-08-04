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
import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConnectionService } from "../../../services/connection/connectionService";
import { ConnectionTargetQuickPickService } from "../../../services/connection/connectionTargetQuickPickService";
import {
  bindingForProfile,
  formatConnectionTargetLabel,
} from "../../../services/connection/connectionTargetLabel";
import { EditorConnectionBindingService } from "../../../services/connection/editorConnectionBindingService";
import { useConnectionState } from "../../../services/connection/useConnectionState";
import { useEditorConnectionBinding } from "../../../services/connection/useEditorConnectionBinding";
import { effectiveDefaultSchema } from "../../../services/connection/connectionTypes";
import "@silk-studio/workbench/components/layout/TitleBar/OpenEditorsQuickPick/OpenEditorsQuickPick.css";
import {
  placeOverSilkEditor,
  TITLEBAR_QUICK_PICK_CLASS,
} from "../../../services/connection/titlebarQuickPickPlacement";
import "./ConnectionTargetStatusItem.css";

type PickItem =
  | { kind: "profile"; profileId: string; label: string; detail: string }
  | { kind: "applyAll"; profileId: string; label: string }
  | { kind: "clear"; label: string };

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
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const label = formatConnectionTargetLabel(binding, {
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

    // Measure while silk-editor is visible, then hide it (Open Editors pattern).
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
    const profiles = ConnectionService.getConnectedProfiles().filter(
      (profile) => {
        if (!query) return true;
        const schema = effectiveDefaultSchema(profile).toLowerCase();
        return (
          profile.name.toLowerCase().includes(query) ||
          profile.user.toLowerCase().includes(query) ||
          schema.includes(query)
        );
      },
    );

    const items: PickItem[] = profiles.map((profile) => {
      const schema = effectiveDefaultSchema(profile);
      return {
        kind: "profile" as const,
        profileId: profile.id,
        label: schema ? `${profile.name} › ${schema}` : profile.name,
        detail: profile.user
          ? `${profile.user} · ${profile.driverId}`
          : profile.driverId,
      };
    });

    items.push({
      kind: "clear",
      label: t("app.connectionTarget.clearBinding"),
    });

    for (const profile of profiles) {
      const schema = effectiveDefaultSchema(profile);
      const name = schema ? `${profile.name} › ${schema}` : profile.name;
      items.push({
        kind: "applyAll",
        profileId: profile.id,
        label: t("app.connectionTarget.applyToAllNamed").replace(
          "{name}",
          name,
        ),
      });
    }

    return items;
  }, [open, filter, connection.connectedProfileIds, t]);

  useEffect(() => {
    setFocusedIndex((current) =>
      picks.length === 0 ? 0 : Math.min(current, picks.length - 1),
    );
  }, [picks]);

  const acceptPick = useCallback(
    (pick: PickItem) => {
      if (pick.kind === "applyAll") {
        EditorConnectionBindingService.setBindingsForAllSqlTabs(
          bindingForProfile(pick.profileId),
        );
        close();
        return;
      }

      const tab = EditorService.getActiveTab();
      if (!tab) {
        close();
        return;
      }
      if (pick.kind === "clear") {
        EditorConnectionBindingService.setBinding(tab.id, {
          profileId: null,
          catalog: null,
          schema: null,
        });
      } else {
        EditorConnectionBindingService.setBinding(
          tab.id,
          bindingForProfile(pick.profileId),
        );
      }
      close();
    },
    [close],
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
      setFocusedIndex((index) => (index + 1) % picks.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (picks.length === 0) return;
      setFocusedIndex((index) => (index - 1 + picks.length) % picks.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const pick = picks[focusedIndex];
      if (!pick) return;
      acceptPick(pick);
    }
  };

  const emptyHint =
    connection.connectedProfileIds.length === 0
      ? t("app.connectionTarget.pickerEmpty")
      : t("app.connectionTarget.pickerNoMatch");

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
                {picks.length === 0 ? (
                  <div className="quick-input-list__empty">{emptyHint}</div>
                ) : (
                  picks.map((pick, index) => {
                    const selected =
                      pick.kind === "profile" &&
                      pick.profileId === binding.profileId;
                    const focused = index === focusedIndex;
                    const rowKey =
                      pick.kind === "profile"
                        ? pick.profileId
                        : pick.kind === "applyAll"
                          ? `apply-${pick.profileId}`
                          : "clear";
                    return (
                      <div
                        key={rowKey}
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
                                pick.kind === "clear"
                                  ? "circle-outline"
                                  : pick.kind === "applyAll"
                                    ? "files"
                                    : selected
                                      ? "check"
                                      : "database"
                              }
                            />
                          </span>
                          <span className="quick-input-list-label connection-target-picker__label">
                            {pick.label}
                          </span>
                          {pick.kind === "profile" ? (
                            <span className="connection-target-picker__detail">
                              {pick.detail}
                            </span>
                          ) : null}
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
