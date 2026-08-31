import { useCallback, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import ContextMenu from "../common/ContextMenu";
import { ConnectionService } from "../../services/connection/connectionService";
import {
  buildObjectMenuItems,
  defaultObjectAction,
  EXPLORER_COMMANDS,
  type ExplorerMenuItem,
  type ExplorerObjectRef,
} from "../../services/connection/explorerObjectActions";
import type { ExplorerObjectSearchPick } from "../../services/connection/explorerSearchItems";
import { useConnectionState } from "../../services/connection/useConnectionState";
import { SearchConnectionSelectionService } from "../../services/search/searchConnectionSelectionService";
import { useSearchConnectionSelection } from "../../services/search/useSearchConnectionSelection";
import {
  ALL_SEARCH_KINDS,
  SearchKindSelectionService,
} from "../../services/search/searchKindSelectionService";
import { useSearchKindSelection } from "../../services/search/useSearchKindSelection";
import {
  MIN_SEARCH_TERM_LENGTH,
  SearchSessionStateService,
} from "../../services/search/searchSessionStateService";
import { useSearchSessionState } from "../../services/search/useSearchSessionState";
import SearchConnectionPicker from "./SearchConnectionPicker";
import SearchKindPicker from "./SearchKindPicker";
import "./SearchExplorer.css";

function SearchExplorer() {
  const { t } = useI18n();
  const connection = useConnectionState(); // Re-renders while connect() flips connecting/connected state, and for the picker's live profile list.
  const selection = useSearchConnectionSelection();
  const kindSelection = useSearchKindSelection();
  // Term/results/status/the in-flight search itself all live in SearchSessionStateService, not
  // component state — Sidebar.tsx only mounts this component while the Search tab is active, so
  // local state (or a search kicked off from a component-scoped callback) would reset/get
  // silently abandoned the moment the user switched to another sidebar tab and back mid-search.
  const { term, results, statusMessage, failedProfileNames } = useSearchSessionState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
  const connectionsButtonRef = useRef<HTMLButtonElement>(null);
  const kindsButtonRef = useRef<HTMLButtonElement>(null);
  const configuration = useConfiguration();
  const readOnly = configuration["database.readOnly"];
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ExplorerMenuItem[];
    ref: ExplorerObjectRef;
  } | null>(null);

  async function handleContextMenuSelect(item: ExplorerMenuItem, ref: ExplorerObjectRef) {
    if (!item.commandId) return;
    try {
      await CommandService.executeCommand(item.commandId, ref);
    } catch (error) {
      console.error("[silk.search]", error);
    }
  }

  const openResult = useCallback(async (pick: ExplorerObjectSearchPick) => {
    const ref: ExplorerObjectRef = {
      profileId: pick.profileId,
      schemaName: pick.schemaName,
      object: pick.object,
      catalogName: pick.catalogName,
    };
    const profile = ConnectionService.getProfile(pick.profileId);
    const primary = defaultObjectAction(pick.object.kind, profile?.driverId);
    const commandId =
      primary === "openObjectEditor"
        ? EXPLORER_COMMANDS.openObjectEditor
        : primary === "openSource"
          ? EXPLORER_COMMANDS.openSource
          : EXPLORER_COMMANDS.viewDdl;
    try {
      await CommandService.executeCommand(commandId, ref);
    } catch (error) {
      console.error("[silk.search]", error);
    }
  }, []);

  const trimmedTerm = term.trim();
  const canSearch = trimmedTerm.length >= MIN_SEARCH_TERM_LENGTH;

  let emptyHint: string | null = null;
  if (statusMessage) {
    emptyHint = null;
  } else if (results !== null && results.length === 0) {
    emptyHint = t("app.search.noMatches");
  } else if (results === null) {
    emptyHint = t("app.search.hint");
  }

  return (
    <div className="search-explorer">
      <div className="search-explorer__input-row">
        <input
          type="text"
          className="search-explorer__input"
          value={term}
          spellCheck={false}
          autoComplete="off"
          placeholder={t("app.search.placeholder")}
          aria-label={t("app.search.inputAria")}
          onChange={(event) => SearchSessionStateService.setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void SearchSessionStateService.runSearch(term);
            }
          }}
        />
        <button
          type="button"
          className="search-explorer__search-button"
          title={t("app.search.searchButton")}
          aria-label={t("app.search.searchButton")}
          disabled={!canSearch}
          onClick={() => void SearchSessionStateService.runSearch(term)}
        >
          <Codicon name="search" />
        </button>
      </div>

      <div className="search-explorer__connections-row">
        <button
          ref={connectionsButtonRef}
          type="button"
          className="search-explorer__connections-button"
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}
        >
          <Codicon name="plug" />
          <span>
            {selection === null
              ? t("app.search.connectionsButtonAll")
              : t("app.search.connectionsButtonCount").replace(
                  "{n}",
                  String(selection.size),
                )}
          </span>
          <Codicon name="chevron-down" />
        </button>
        {pickerOpen ? (
          <SearchConnectionPicker
            profiles={connection.profiles}
            selection={selection}
            anchorRef={connectionsButtonRef}
            onChange={(next) => SearchConnectionSelectionService.setSelection(next)}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}

        <button
          ref={kindsButtonRef}
          type="button"
          className="search-explorer__connections-button"
          aria-haspopup="menu"
          aria-expanded={kindPickerOpen}
          onClick={() => setKindPickerOpen((open) => !open)}
        >
          <Codicon name="filter" />
          <span>
            {kindSelection.size === ALL_SEARCH_KINDS.length
              ? t("app.search.kindsButtonAll")
              : t("app.search.kindsButtonCount").replace(
                  "{n}",
                  String(kindSelection.size),
                )}
          </span>
          <Codicon name="chevron-down" />
        </button>
        {kindPickerOpen ? (
          <SearchKindPicker
            selection={kindSelection}
            anchorRef={kindsButtonRef}
            onChange={(next) => SearchKindSelectionService.setSelection(next)}
            onClose={() => setKindPickerOpen(false)}
          />
        ) : null}
      </div>

      {statusMessage ? (
        <div className="search-explorer__status" role="status">
          <Codicon name="loading" />
          <span className="search-explorer__status-text">{statusMessage}</span>
          <button
            type="button"
            className="search-explorer__cancel-button"
            onClick={() => SearchSessionStateService.cancelSearch()}
          >
            {t("app.search.cancel")}
          </button>
        </div>
      ) : null}

      {!statusMessage && failedProfileNames && failedProfileNames.length > 0 ? (
        <div className="search-explorer__warning" role="alert">
          <Codicon name="warning" />
          <span>
            {t("app.search.partialResultsWarning").replace(
              "{names}",
              failedProfileNames.join(", "),
            )}
          </span>
        </div>
      ) : null}

      <div className="search-explorer__results">
        {emptyHint ? (
          <div className="search-explorer__empty">{emptyHint}</div>
        ) : results && results.length > 0 ? (
          <>
            <div className="search-explorer__result-count">
              {t("app.search.resultCount").replace("{n}", String(results.length))}
            </div>
            {results.map((pick) => (
              <div
                key={pick.id}
                className="search-explorer__result"
                role="button"
                tabIndex={0}
                onClick={() => void openResult(pick)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void openResult(pick);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const ref: ExplorerObjectRef = {
                    profileId: pick.profileId,
                    schemaName: pick.schemaName,
                    object: pick.object,
                    catalogName: pick.catalogName,
                  };
                  const profile = ConnectionService.getProfile(pick.profileId);
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    ref,
                    items: buildObjectMenuItems(pick.object.kind, {
                      driverId: profile?.driverId,
                      readOnly,
                      canMutate:
                        ConnectionService.isConnected(pick.profileId) && !readOnly,
                    }),
                  });
                }}
              >
                <span className="search-explorer__result-icon" aria-hidden>
                  <Codicon name={pick.icon} />
                </span>
                <span className="search-explorer__result-label">{pick.label}</span>
                <span className="search-explorer__result-description">
                  {pick.description}
                </span>
              </div>
            ))}
          </>
        ) : null}
      </div>

      {contextMenu ? (
        <ContextMenu
          anchor={{ top: contextMenu.y, left: contextMenu.x }}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
          onSelect={(item) => void handleContextMenuSelect(item, contextMenu.ref)}
        />
      ) : null}
    </div>
  );
}

export default SearchExplorer;
