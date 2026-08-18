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
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import {
  buildExplorerSearchPicksAcrossProfiles,
  type ExplorerSearchPick,
} from "../../services/connection/explorerSearchItems";
import { runWithConcurrency } from "../../services/connection/explorerSearchPrefetchService";
import { ExplorerSearchQuickPickService } from "../../services/connection/explorerSearchQuickPickService";
import {
  defaultObjectAction,
  EXPLORER_COMMANDS,
  type ExplorerObjectRef,
} from "../../services/connection/explorerObjectActions";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { useConnectionState } from "../../services/connection/useConnectionState";
import { useConnectionTrees } from "../../services/connection/useConnectionTree";
import {
  placeOverSilkEditor,
  TITLEBAR_QUICK_PICK_CLASS,
} from "@silk-studio/workbench/services/quickinput/titlebarQuickPickPlacement.ts";
import "@silk-studio/workbench/components/layout/TitleBar/OpenEditorsQuickPick/OpenEditorsQuickPick.css";
import "./ExplorerSearchQuickPick.css";

function ExplorerSearchQuickPick() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => ExplorerSearchQuickPickService.isOpen());
  const [filter, setFilter] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busySchema, setBusySchema] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const connection = useConnectionState();
  // Every connected profile, not just the one bound to the active tab — a table can live on
  // any open connection, and the user has no way to tell which one from the SQL alone.
  const connectedProfileIds = connection.connectedProfileIds;
  const trees = useConnectionTrees(connectedProfileIds);

  useEffect(() => {
    return ExplorerSearchQuickPickService.onDidChange(() => {
      const next = ExplorerSearchQuickPickService.isOpen();
      setOpen(next);
      setPlaced(false);
      if (next) {
        setFilter("");
        setFocusedIndex(0);
        setStatusMessage(null);
      }
    });
  }, []);

  const profiles = useMemo(
    () =>
      connectedProfileIds.map((profileId) => ({
        profileId,
        cache: trees.get(profileId) ?? {
          status: "idle" as const,
          errorMessage: null,
          catalogs: [],
          currentCatalog: null,
          schemas: [],
        },
        label: ConnectionService.getProfile(profileId)?.name?.trim() || profileId,
      })),
    [connectedProfileIds, trees],
  );

  const picks = useMemo(() => {
    if (profiles.length === 0 || !open) return [] as ExplorerSearchPick[];
    return buildExplorerSearchPicksAcrossProfiles(profiles, filter);
  }, [profiles, filter, open]);

  // Prefetch progress (only meaningful for catalog-style dialects, e.g. SQL Server) — summed
  // across every connected profile being searched.
  const prefetchProgress = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const { cache } of profiles) {
      if (cache.catalogs.length === 0) continue;
      total += cache.catalogs.length;
      done += cache.catalogs.filter(
        (catalog) => catalog.status === "loaded" || catalog.status === "error",
      ).length;
    }
    if (total === 0 || done >= total) return null;
    return { done, total };
  }, [profiles]);

  useEffect(() => {
    setFocusedIndex((current) =>
      picks.length === 0 ? 0 : Math.min(current, picks.length - 1),
    );
  }, [picks]);

  const close = useCallback(() => {
    ExplorerSearchQuickPickService.hide();
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      document.documentElement.classList.remove(TITLEBAR_QUICK_PICK_CLASS);
      return;
    }

    const el = rootRef.current;
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
  }, [open, filter, focusedIndex, picks.length, statusMessage]);

  useEffect(() => {
    if (!open) return;
    const frameId = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open, close]);

  useCloseOnAppBlur(close, open);

  const acceptPick = useCallback(
    async (pick: ExplorerSearchPick, alternate: boolean) => {
      if (pick.type === "loadCatalog") {
        setBusySchema(pick.catalogName);
        setStatusMessage(`Loading ${pick.catalogName}…`);
        try {
          await ConnectionTreeService.loadCatalogSchemas(
            pick.profileId,
            pick.catalogName,
            true,
          );
          // A catalog "loaded" only means its schema *names* are known — load every
          // schema's objects too so this one click makes the whole database searchable,
          // instead of leaving the user to click through each schema individually.
          const catalog = ConnectionTreeService.getCache(pick.profileId).catalogs.find(
            (item) => item.name.toLowerCase() === pick.catalogName.toLowerCase(),
          );
          const schemaNames = catalog?.schemas.map((schema) => schema.name) ?? [];
          let loaded = 0;
          setStatusMessage(
            `Loading ${pick.catalogName} (0/${schemaNames.length} schemas)…`,
          );
          await runWithConcurrency(schemaNames, 3, async (schemaName) => {
            try {
              await ConnectionTreeService.loadSchemaObjects(
                pick.profileId,
                schemaName,
                false,
                pick.catalogName,
              );
            } catch {
              // Best-effort per schema — a failure here just leaves that one unsearchable.
            }
            loaded += 1;
            setStatusMessage(
              `Loading ${pick.catalogName} (${loaded}/${schemaNames.length} schemas)…`,
            );
          });
          setStatusMessage(`Loaded ${pick.catalogName}. Continue typing to filter.`);
        } catch (error) {
          setStatusMessage(formatErrorMessage(error, t("app.explorer.searchLoadFailed")));
        } finally {
          setBusySchema(null);
          inputRef.current?.focus();
        }
        return;
      }

      if (pick.type === "loadSchema") {
        const busyKey = pick.catalogName
          ? `${pick.catalogName}.${pick.schemaName}`
          : pick.schemaName;
        setBusySchema(busyKey);
        setStatusMessage(`Loading ${busyKey}…`);
        try {
          await ConnectionTreeService.loadSchemaObjects(
            pick.profileId,
            pick.schemaName,
            true,
            pick.catalogName,
          );
          setStatusMessage(`Loaded ${busyKey}. Continue typing to filter.`);
        } catch (error) {
          setStatusMessage(formatErrorMessage(error, t("app.explorer.searchLoadFailed")));
        } finally {
          setBusySchema(null);
          inputRef.current?.focus();
        }
        return;
      }

      const ref: ExplorerObjectRef = {
        profileId: pick.profileId,
        schemaName: pick.schemaName,
        object: pick.object,
        catalogName: pick.catalogName,
      };
      const profile = ConnectionService.getProfile(pick.profileId);
      const primary = defaultObjectAction(
        pick.object.kind,
        profile?.driverId,
      );
      let commandId =
        primary === "openObjectEditor"
          ? EXPLORER_COMMANDS.openObjectEditor
          : primary === "openSource"
            ? EXPLORER_COMMANDS.openSource
            : EXPLORER_COMMANDS.viewDdl;

      if (alternate) {
        // Opposite of the primary action (data ↔ DDL, source ↔ DDL).
        commandId =
          primary === "openObjectEditor"
            ? EXPLORER_COMMANDS.viewDdl
            : primary === "openSource"
              ? EXPLORER_COMMANDS.viewDdl
              : pick.object.kind === "table" || pick.object.kind === "view"
                ? EXPLORER_COMMANDS.openObjectEditor
                : EXPLORER_COMMANDS.viewDdl;
      }

      close();
      try {
        await CommandService.executeCommand(commandId, ref);
      } catch (error) {
        console.error("[silk.explorer.search]", error);
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
      void acceptPick(pick, event.ctrlKey || event.metaKey);
    }
  };

  if (!open) {
    return null;
  }

  const connected = profiles.length > 0;
  const anyLoading = profiles.some(({ cache }) => cache.status === "loading");
  const anySchemasKnown = profiles.some(
    ({ cache }) => cache.catalogs.length > 0 || cache.schemas.length > 0,
  );
  const emptyHint = !connected
    ? t("app.explorer.searchNeedConnect")
    : anyLoading && !anySchemasKnown
      ? t("app.explorer.loadingSchemas")
      : !anySchemasKnown
        ? t("app.explorer.searchNoSchemas")
        : filter.trim()
          ? t("app.explorer.searchNoMatch")
          : t("app.explorer.searchHint");

  return createPortal(
    <div
      ref={rootRef}
      className="quick-input-widget explorer-search-quick-pick"
      role="dialog"
      aria-modal="true"
      aria-label={t("app.explorer.searchTitle")}
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
            type="text"
            className="quick-input-box"
            value={filter}
            spellCheck={false}
            autoComplete="off"
            placeholder={t("app.explorer.searchPlaceholder")}
            aria-label={t("app.explorer.searchAria")}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>
      </div>

      <div className="explorer-search-quick-pick__hint" role="note">
        Enter opens data/DDL · Ctrl+Enter opens the other action
      </div>

      <div className="quick-input-list" role="listbox">
        {picks.length === 0 ? (
          <div className="quick-input-list__empty">{emptyHint}</div>
        ) : (
          picks.map((pick, index) => {
            const isFocused = index === focusedIndex;
            const loading =
              (pick.type === "loadSchema" &&
                busySchema ===
                  (pick.catalogName
                    ? `${pick.catalogName}.${pick.schemaName}`
                    : pick.schemaName)) ||
              (pick.type === "loadCatalog" && busySchema === pick.catalogName);
            return (
              <div
                key={pick.id}
                className={`quick-input-list-row${isFocused ? " quick-input-list-row--focused" : ""}`}
                role="option"
                aria-selected={isFocused}
                onMouseEnter={() => setFocusedIndex(index)}
                onClick={() => void acceptPick(pick, false)}
              >
                <div className="quick-input-list-entry">
                  <span className="quick-input-list-icon" aria-hidden>
                    <Codicon name={loading ? "loading" : pick.icon} />
                  </span>
                  <span className="quick-input-list-label explorer-search-quick-pick__label">
                    {pick.label}
                  </span>
                  <span className="explorer-search-quick-pick__description">
                    {pick.description}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {statusMessage ? (
        <div className="explorer-search-quick-pick__status" role="status">
          {statusMessage}
        </div>
      ) : prefetchProgress ? (
        <div className="explorer-search-quick-pick__status" role="status">
          {`Loading databases in background: ${prefetchProgress.done}/${prefetchProgress.total}…`}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

export default ExplorerSearchQuickPick;
