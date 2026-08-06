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
import {
  effectiveDefaultSchema,
  getConnectionDriver,
} from "../../../services/connection/connectionTypes";
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

type PickItem =
  | { kind: "separator"; id: string; label: string }
  | { kind: "hint"; id: string; label: string }
  | { kind: "profile"; profileId: string; label: string; detail: string }
  | {
      kind: "catalog";
      profileId: string;
      catalogName: string;
      label: string;
    }
  | { kind: "applyAll"; profileId: string; label: string }
  | { kind: "clear"; label: string };

function isSelectable(pick: PickItem): boolean {
  return pick.kind !== "separator" && pick.kind !== "hint";
}

function profilePathLabel(
  name: string,
  catalog: string,
  schema: string,
): string {
  if (catalog && schema) return `${name} › ${catalog} › ${schema}`;
  if (catalog) return `${name} › ${catalog}`;
  if (schema) return `${name} › ${schema}`;
  return name;
}

function supportsCatalogProfile(profileId: string): boolean {
  const profile = ConnectionService.getProfile(profileId);
  return Boolean(
    profile && getConnectionDriver(profile.driverId).supportsCatalog,
  );
}

function ConnectionTargetStatusItem() {
  const { t } = useI18n();
  const binding = useEditorConnectionBinding();
  const connection = useConnectionState();
  const [open, setOpen] = useState(() =>
    ConnectionTargetQuickPickService.isOpen(),
  );
  const [filter, setFilter] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [catalogSourceProfileId, setCatalogSourceProfileId] = useState<
    string | null
  >(null);
  const [treeRev, setTreeRev] = useState(0);
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
  }, [open, filter, focusedIndex, catalogSourceProfileId, treeRev]);

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

  // Reset catalog source when the picker opens.
  useEffect(() => {
    if (!open) return;
    const boundId = binding.profileId;
    if (
      boundId &&
      ConnectionService.isConnected(boundId) &&
      supportsCatalogProfile(boundId)
    ) {
      setCatalogSourceProfileId(boundId);
      return;
    }
    const first = ConnectionService.getConnectedProfiles().find((profile) =>
      getConnectionDriver(profile.driverId).supportsCatalog,
    );
    setCatalogSourceProfileId(first?.id ?? null);
    // Only when opening — hover/keyboard may preview another connection's databases.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [open]);

  // Load databases for every connected catalog-capable profile.
  useEffect(() => {
    if (!open) return;
    for (const profile of ConnectionService.getConnectedProfiles()) {
      if (!getConnectionDriver(profile.driverId).supportsCatalog) continue;
      const cache = ConnectionTreeService.getCache(profile.id);
      if (cache.catalogs.length > 0 || cache.status === "loading") continue;
      void ConnectionTreeService.loadSchemas(profile.id).catch(() => {
        /* picker still works with profiles only */
      });
    }
  }, [open, connection.connectedProfileIds]);

  useEffect(() => {
    if (!open) return;
    return ConnectionTreeService.onDidChange(() => {
      setTreeRev((value) => value + 1);
    });
  }, [open]);

  const picks = useMemo((): PickItem[] => {
    if (!open) return [];
    void treeRev;
    const query = filter.trim().toLowerCase();
    const profiles = ConnectionService.getConnectedProfiles().filter(
      (profile) => {
        if (!query) return true;
        const schema = effectiveDefaultSchema(profile).toLowerCase();
        const catalog = profile.catalog.trim().toLowerCase();
        return (
          profile.name.toLowerCase().includes(query) ||
          profile.user.toLowerCase().includes(query) ||
          schema.includes(query) ||
          catalog.includes(query)
        );
      },
    );

    const items: PickItem[] = [];

    items.push({
      kind: "separator",
      id: "connections",
      label: t("app.connectionTarget.sectionConnections"),
    });

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
        const catalog = profile.catalog.trim();
        const schema = effectiveDefaultSchema(profile);
        items.push({
          kind: "profile",
          profileId: profile.id,
          label: profilePathLabel(profile.name, catalog, schema),
          detail: profile.user
            ? `${profile.user} · ${profile.driverId}`
            : profile.driverId,
        });
      }
    }

    const sourceId =
      catalogSourceProfileId &&
      ConnectionService.isConnected(catalogSourceProfileId) &&
      supportsCatalogProfile(catalogSourceProfileId)
        ? catalogSourceProfileId
        : null;

    if (sourceId) {
      const sourceProfile = ConnectionService.getProfile(sourceId);
      const sourceName = sourceProfile?.name ?? sourceId;
      items.push({
        kind: "separator",
        id: "databases",
        label: t("app.connectionTarget.sectionDatabases").replace(
          "{name}",
          sourceName,
        ),
      });

      const cache = ConnectionTreeService.getCache(sourceId);
      const catalogs = cache.catalogs
        .map((item) => item.name)
        .filter((name) => {
          if (!query) return true;
          return name.toLowerCase().includes(query);
        });

      if (catalogs.length === 0) {
        items.push({
          kind: "hint",
          id: "databases-empty",
          label:
            cache.status === "loading"
              ? t("app.explorer.loadingDatabases")
              : query
                ? t("app.connectionTarget.pickerNoMatch")
                : t("app.connectionTarget.databasesEmpty"),
        });
      } else {
        for (const catalogName of catalogs) {
          items.push({
            kind: "catalog",
            profileId: sourceId,
            catalogName,
            label: catalogName,
          });
        }
      }
    }

    items.push({
      kind: "separator",
      id: "other",
      label: t("app.connectionTarget.sectionOther"),
    });

    items.push({
      kind: "clear",
      label: t("app.connectionTarget.clearBinding"),
    });

    for (const profile of ConnectionService.getConnectedProfiles().filter(
      (profile) => {
        if (!query) return true;
        const schema = effectiveDefaultSchema(profile).toLowerCase();
        const catalog = profile.catalog.trim().toLowerCase();
        return (
          profile.name.toLowerCase().includes(query) ||
          profile.user.toLowerCase().includes(query) ||
          schema.includes(query) ||
          catalog.includes(query)
        );
      },
    )) {
      const catalog = profile.catalog.trim();
      const schema = effectiveDefaultSchema(profile);
      items.push({
        kind: "applyAll",
        profileId: profile.id,
        label: t("app.connectionTarget.applyToAllNamed").replace(
          "{name}",
          profilePathLabel(profile.name, catalog, schema),
        ),
      });
    }

    return items;
  }, [open, filter, connection.connectedProfileIds, catalogSourceProfileId, treeRev, t]);

  const focusPick = useCallback(
    (index: number) => {
      setFocusedIndex(index);
      const pick = picks[index];
      if (pick?.kind === "catalog") {
        setCatalogSourceProfileId(pick.profileId);
        return;
      }
      if (pick?.kind === "profile") {
        setCatalogSourceProfileId(
          supportsCatalogProfile(pick.profileId) ? pick.profileId : null,
        );
      }
    },
    [picks],
  );

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

      if (pick.kind === "applyAll") {
        EditorConnectionBindingService.setBindingsForAllSqlTabs(
          bindingForProfile(pick.profileId),
        );
        close();
        return;
      }

      if (pick.kind === "catalog") {
        void ActiveDatabaseService.useDatabase(
          pick.profileId,
          pick.catalogName,
        )
          .then(() => {
            AppNotificationService.show(
              t("app.explorer.usingDatabase").replace(
                "{name}",
                pick.catalogName,
              ),
              "info",
            );
          })
          .catch((error) => {
            AppNotificationService.show(
              formatErrorMessage(
                error,
                t("app.explorer.useDatabaseFailed"),
              ),
              "error",
            );
          });
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
      } else if (pick.kind === "profile") {
        EditorConnectionBindingService.setBinding(
          tab.id,
          bindingForProfile(pick.profileId),
        );
      }
      close();
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
      focusPick(findSelectableIndex(focusedIndex, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (picks.length === 0) return;
      focusPick(findSelectableIndex(focusedIndex, -1));
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
    connection.connectedProfileIds.length === 0
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
                    if (pick.kind === "separator") {
                      return (
                        <div
                          key={`sep-${pick.id}`}
                          className="connection-target-picker__separator"
                          role="presentation"
                        >
                          {pick.label}
                        </div>
                      );
                    }
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

                    const selected =
                      (pick.kind === "profile" &&
                        pick.profileId === binding.profileId) ||
                      (pick.kind === "catalog" &&
                        pick.profileId === binding.profileId &&
                        pick.catalogName.toLowerCase() ===
                          (binding.catalog ?? "").toLowerCase());
                    const focused = index === focusedIndex;
                    const rowKey =
                      pick.kind === "profile"
                        ? pick.profileId
                        : pick.kind === "catalog"
                          ? `catalog-${pick.profileId}-${pick.catalogName}`
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
                        onMouseEnter={() => focusPick(index)}
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
                                    : pick.kind === "catalog"
                                      ? selected
                                        ? "check"
                                        : "folder"
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
