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
import { bridgeFindObjectsByName } from "../../services/connection/connectionBridge";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import {
  buildExplorerSearchPicksAcrossProfiles,
  buildLiveSearchResultPick,
  type ExplorerLiveSearchActionPick,
  type ExplorerSearchPick,
} from "../../services/connection/explorerSearchItems";
import { runWithConcurrency } from "../../services/runWithConcurrency";
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

/**
 * Below this, an all-connections substring scan is more noise than signal (near-every table
 * matches a 1-character needle) — the live-search action pick only appears once the filter is at
 * least this long.
 */
const MIN_LIVE_SEARCH_TERM_LENGTH = 2;

/** Concurrency cap for per-profile live searches — matches the loadCatalog pick's schema-loading loop below, for consistency. */
const LIVE_SEARCH_CONCURRENCY = 3;

function ExplorerSearchQuickPick() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => ExplorerSearchQuickPickService.isOpen());
  const [filter, setFilter] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busySchema, setBusySchema] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  // Non-null once a live "search all connections" query has resolved — overrides the
  // cache-based picks entirely (see the `picks` memo below) until the filter changes again.
  const [liveResults, setLiveResults] = useState<ExplorerSearchPick[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Monotonic "search generation" — bumped on every new live search (explicit re-click, or the
  // filter changing while one is in flight) so a slow, superseded response is silently discarded
  // instead of clobbering a newer search's results. Mirrors AG Grid's infinite-row-model
  // block-versioning pattern: capture the generation before the async work starts, compare it to
  // the current ref value when the work finishes, and bail out if they differ.
  const searchGenerationRef = useRef(0);

  const connection = useConnectionState();
  // Every connected profile, not just the one bound to the active tab — a table can live on
  // any open connection, and the user has no way to tell which one from the SQL alone.
  const connectedProfileIds = connection.connectedProfileIds;
  const trees = useConnectionTrees(connectedProfileIds);

  // Set by the onDidChange handler below when opened via `show({ autoRunLiveSearch: true })`
  // (the Ctrl+Space fallback item) — names the filter value that should trigger an automatic
  // live search once it's actually reflected in `filter` state. Consumed (and cleared) by the
  // `[filter]`-keyed effect further down, *after* that effect's own generation bump, so the
  // auto-run search's generation is never immediately invalidated by its own filter-change.
  const autoRunFilterRef = useRef<string | null>(null);

  const runLiveSearch = useCallback(
    async (searchTerm: string) => {
      searchGenerationRef.current += 1;
      const generation = searchGenerationRef.current;
      setStatusMessage(t("app.explorer.searchLiveSearching"));
      setLiveResults(null);

      const connectedProfiles = ConnectionService.getConnectedProfiles();
      const showLabels = connectedProfiles.length > 1;
      const results: ExplorerSearchPick[] = [];
      await runWithConcurrency(
        connectedProfiles,
        LIVE_SEARCH_CONCURRENCY,
        async (profile) => {
          try {
            const response = await bridgeFindObjectsByName(
              profile.id,
              searchTerm,
              { contains: true },
            );
            for (const found of response.objects) {
              results.push(
                buildLiveSearchResultPick(
                  profile.id,
                  showLabels ? profile.name : undefined,
                  found,
                ),
              );
            }
          } catch {
            // Best-effort across connections — one profile failing/timing out shouldn't blank
            // the search results from every other connected profile.
          }
        },
      );

      // Stale-response guard: a newer search (re-click, or the filter changed) has started
      // since this one began — discard this response silently rather than clobbering it.
      if (searchGenerationRef.current !== generation) return;

      results.sort((a, b) => {
        const byLabel = a.label.localeCompare(b.label);
        if (byLabel !== 0) return byLabel;
        return a.description.localeCompare(b.description);
      });
      setLiveResults(results);
      setStatusMessage(null);
      inputRef.current?.focus();
    },
    [t],
  );

  useEffect(() => {
    return ExplorerSearchQuickPickService.onDidChange(() => {
      const next = ExplorerSearchQuickPickService.isOpen();
      setOpen(next);
      setPlaced(false);
      if (next) {
        const pending = ExplorerSearchQuickPickService.consumePendingRequest();
        const initialFilter = pending?.initialFilter ?? "";
        setFilter(initialFilter);
        setFocusedIndex(0);
        setStatusMessage(null);
        setLiveResults(null);
        autoRunFilterRef.current =
          pending?.autoRunLiveSearch && initialFilter.trim()
            ? initialFilter.trim()
            : null;
      }
    });
  }, []);

  // Typing further after a live search resolved (or while one is in flight) invalidates it — the
  // results/in-flight query no longer match what's in the box. Bumping the generation here (not
  // just in the live-search handler itself) makes an in-flight response for the old filter get
  // silently discarded when it eventually resolves.
  useEffect(() => {
    searchGenerationRef.current += 1;
    setLiveResults(null);

    // Auto-run request from opening via `show({ autoRunLiveSearch: true })` — fires *after* the
    // generation bump above, once `filter` state actually reflects the pre-filled term, so the
    // search this kicks off isn't immediately treated as stale by the bump that just happened.
    if (autoRunFilterRef.current !== null && autoRunFilterRef.current === filter.trim()) {
      const term = autoRunFilterRef.current;
      autoRunFilterRef.current = null;
      void runLiveSearch(term);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runLiveSearch is stable enough in
    // practice (see its own useCallback deps); including it here would refire this effect (and
    // re-bump the generation) on every render where its identity changes for unrelated reasons.
  }, [filter]);

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

  const trimmedFilter = filter.trim();
  const connected = profiles.length > 0;
  const showLiveSearchAction =
    connected && trimmedFilter.length >= MIN_LIVE_SEARCH_TERM_LENGTH;

  const liveSearchActionPick: ExplorerLiveSearchActionPick | null = showLiveSearchAction
    ? {
        type: "liveSearch",
        id: `liveSearch:${trimmedFilter}`,
        label: t("app.explorer.searchLiveAction").replace("{term}", trimmedFilter),
        description: t("app.explorer.searchLiveActionDescription"),
        icon: "search",
        searchTerm: trimmedFilter,
      }
    : null;

  const picks = useMemo(() => {
    // Once a live search has resolved, it fully replaces the cache-based list (and the action
    // pick itself) until the filter changes again — see the `filter`-keyed effect above.
    if (liveResults) return liveResults;
    if (profiles.length === 0 || !open) return [] as ExplorerSearchPick[];
    const cachePicks = buildExplorerSearchPicksAcrossProfiles(profiles, filter);
    return liveSearchActionPick ? [...cachePicks, liveSearchActionPick] : cachePicks;
  }, [profiles, filter, open, liveResults, liveSearchActionPick]);

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
                false,
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
            false,
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

      if (pick.type === "liveSearch") {
        await runLiveSearch(pick.searchTerm);
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
    [close, t, runLiveSearch],
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

  const anyLoading = profiles.some(({ cache }) => cache.status === "loading");
  const anySchemasKnown = profiles.some(
    ({ cache }) => cache.catalogs.length > 0 || cache.schemas.length > 0,
  );
  const emptyHint = liveResults
    ? t("app.explorer.searchLiveNoMatches")
    : !connected
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
      ) : null}
    </div>,
    document.body,
  );
}

export default ExplorerSearchQuickPick;
