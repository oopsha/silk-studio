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
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConnectionService } from "../../../services/connection/connectionService";
import { DatabaseTargetQuickPickService } from "../../../services/connection/databaseTargetQuickPickService";
import {
  formatDatabaseLabel,
  formatSchemaLabel,
} from "../../../services/connection/connectionTargetLabel";
import { useEditorConnectionBinding } from "../../../services/connection/useEditorConnectionBinding";
import { getConnectionDriver } from "../../../services/connection/connectionTypes";
import { ConnectionTreeService } from "../../../services/connection/connectionTreeService";
import { ActiveDatabaseService } from "../../../services/connection/activeDatabaseService";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import { formatErrorMessage } from "../../../services/formatErrorMessage";
import "@silk-studio/workbench/components/layout/TitleBar/OpenEditorsQuickPick/OpenEditorsQuickPick.css";
import {
  placeOverSilkEditor,
  TITLEBAR_QUICK_PICK_CLASS,
} from "@silk-studio/workbench/services/quickinput/titlebarQuickPickPlacement.ts";
import "./ConnectionTargetStatusItem.css";

type Mode = "catalog" | "schema";

type PickItem =
  | { kind: "hint"; id: string; label: string }
  | { kind: "item"; name: string; label: string };

/** Status bar picker for the *database or schema* within the active editor tab's bound
 * connection — whichever is the browsable namespace for that driver:
 *  - catalog (database) for SQL Server / MySQL / MariaDB / PostgreSQL-before-load
 *  - schema for Oracle / PostgreSQL (once its schema-only metadata resolves)
 * Hidden entirely when there is no bound connection, or the driver has neither concept. */
function DatabaseTargetStatusItem() {
  const { t } = useI18n();
  const binding = useEditorConnectionBinding();
  const [open, setOpen] = useState(() =>
    DatabaseTargetQuickPickService.isOpen(),
  );
  const [filter, setFilter] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [treeRev, setTreeRev] = useState(0);
  const [placed, setPlaced] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const profileId = binding.profileId;
  const profile = profileId ? ConnectionService.getProfile(profileId) : undefined;
  const connected = Boolean(profileId) && ConnectionService.isConnected(profileId!);
  const driver = profile ? getConnectionDriver(profile.driverId) : null;
  const visible = Boolean(
    profileId && driver && (driver.supportsCatalog || driver.showSchemaField),
  );

  const cache = profileId ? ConnectionTreeService.getCache(profileId) : null;
  const mode: Mode = useMemo(() => {
    if (cache && cache.catalogs.length > 0) return "catalog";
    if (cache && cache.schemas.length > 0) return "schema";
    return driver?.supportsCatalog ? "catalog" : "schema";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- treeRev drives cache refresh
  }, [cache, driver, treeRev]);

  const label =
    mode === "catalog"
      ? formatDatabaseLabel(binding, t("app.connectionTarget.noDatabase"))
      : formatSchemaLabel(binding, t("app.connectionTarget.noSchema"));

  useEffect(() => {
    return DatabaseTargetQuickPickService.onDidChange(() => {
      const next = DatabaseTargetQuickPickService.isOpen();
      setOpen(next);
      setPlaced(false);
      if (next) {
        setFilter("");
        setFocusedIndex(0);
      }
    });
  }, []);

  const close = useCallback(() => {
    DatabaseTargetQuickPickService.hide();
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
  }, [open, filter, focusedIndex, treeRev]);

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

  // Close automatically if the bound connection stops being catalog/schema-capable
  // (rebind to a different connection, or the tab loses its binding) while open.
  useEffect(() => {
    if (open && !visible) close();
  }, [open, visible, close]);

  useEffect(() => {
    if (!open || !profileId || !connected) return;
    const c = ConnectionTreeService.getCache(profileId);
    if (c.catalogs.length > 0 || c.schemas.length > 0 || c.status === "loading") return;
    void ConnectionTreeService.loadSchemas(profileId).catch(() => {
      /* picker still opens empty */
    });
  }, [open, profileId, connected]);

  useEffect(() => {
    if (!open) return;
    return ConnectionTreeService.onDidChange(() => {
      setTreeRev((value) => value + 1);
    });
  }, [open]);

  const picks = useMemo((): PickItem[] => {
    if (!open || !profileId) return [];
    void treeRev;
    const query = filter.trim().toLowerCase();
    const c = ConnectionTreeService.getCache(profileId);
    const names = (mode === "catalog" ? c.catalogs : c.schemas)
      .map((item) => item.name)
      .filter((name) => (query ? name.toLowerCase().includes(query) : true));

    if (names.length === 0) {
      return [
        {
          kind: "hint",
          id: "empty",
          label:
            c.status === "loading"
              ? mode === "catalog"
                ? t("app.explorer.loadingDatabases")
                : t("app.explorer.loadingSchemas")
              : query
                ? t("app.connectionTarget.pickerNoMatch")
                : mode === "catalog"
                  ? t("app.connectionTarget.databasesEmpty")
                  : t("app.connectionTarget.schemasEmpty"),
        },
      ];
    }

    return names.map((name) => ({
      kind: "item" as const,
      name,
      label: name,
    }));
  }, [open, profileId, filter, mode, treeRev, t]);

  const isSelectable = (pick: PickItem) => pick.kind === "item";

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
    setFocusedIndex((current) => Math.min(current, Math.max(picks.length - 1, 0)));
  }, [picks]);

  const acceptPick = useCallback(
    (pick: PickItem) => {
      if (pick.kind !== "item" || !profileId) return;
      const action =
        mode === "catalog"
          ? ActiveDatabaseService.useDatabase(profileId, pick.name)
          : ActiveDatabaseService.useSchema(profileId, pick.name);
      void action
        .then(() => {
          AppNotificationService.show(
            (mode === "catalog"
              ? t("app.explorer.usingDatabase")
              : t("app.explorer.usingSchema")
            ).replace("{name}", pick.name),
            "info",
          );
        })
        .catch((error) => {
          AppNotificationService.show(
            formatErrorMessage(
              error,
              mode === "catalog"
                ? t("app.explorer.useDatabaseFailed")
                : t("app.explorer.useSchemaFailed"),
            ),
            "error",
          );
        });
      close();
    },
    [close, mode, profileId, t],
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

  if (!visible) return null;

  const hasSelectable = picks.some(isSelectable);
  const pickerTitle = t(
    mode === "catalog"
      ? "app.connectionTarget.databasePickerTitle"
      : "app.connectionTarget.schemaPickerTitle",
  );
  const pickerPlaceholder = t(
    mode === "catalog"
      ? "app.connectionTarget.databasePickerPlaceholder"
      : "app.connectionTarget.schemaPickerPlaceholder",
  );
  const ariaLabel = t(
    mode === "catalog"
      ? "app.connectionTarget.databaseAriaLabel"
      : "app.connectionTarget.schemaAriaLabel",
  ).replace("{label}", label);
  const boundSelector = mode === "catalog" ? binding.catalog : binding.schema;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="status-bar__item"
        data-database-target-anchor
        title={pickerTitle}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => DatabaseTargetQuickPickService.toggle()}
      >
        <Codicon name="folder" />
        <span>{label}</span>
      </button>

      {open
        ? createPortal(
            <div
              ref={pickerRef}
              className="quick-input-widget connection-target-picker"
              role="dialog"
              aria-modal="true"
              aria-label={pickerTitle}
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
                    placeholder={pickerPlaceholder}
                    aria-label={pickerPlaceholder}
                    onChange={(event) => setFilter(event.target.value)}
                    onKeyDown={handleInputKeyDown}
                  />
                </div>
              </div>
              <div className="quick-input-list" role="listbox">
                {!hasSelectable ? (
                  <div className="quick-input-list__empty">
                    {picks[0]?.kind === "hint" ? picks[0].label : ""}
                  </div>
                ) : (
                  picks.map((pick, index) => {
                    if (pick.kind === "hint") return null;
                    const selected =
                      pick.name.toLowerCase() ===
                      (boundSelector ?? "").toLowerCase();
                    const focused = index === focusedIndex;
                    return (
                      <div
                        key={pick.name}
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
                            <Codicon name={selected ? "check" : "folder"} />
                          </span>
                          <span className="quick-input-list-label connection-target-picker__label">
                            {pick.label}
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

export default DatabaseTargetStatusItem;
