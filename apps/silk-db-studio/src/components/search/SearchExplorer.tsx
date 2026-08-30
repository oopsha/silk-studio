import { useCallback, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { ConnectionService } from "../../services/connection/connectionService";
import {
  defaultObjectAction,
  EXPLORER_COMMANDS,
  type ExplorerObjectRef,
} from "../../services/connection/explorerObjectActions";
import type { ExplorerObjectSearchPick } from "../../services/connection/explorerSearchItems";
import { useConnectionState } from "../../services/connection/useConnectionState";
import { SearchConnectionSelectionService } from "../../services/search/searchConnectionSelectionService";
import { useSearchConnectionSelection } from "../../services/search/useSearchConnectionSelection";
import {
  MIN_SEARCH_TERM_LENGTH,
  SearchSessionStateService,
} from "../../services/search/searchSessionStateService";
import { useSearchSessionState } from "../../services/search/useSearchSessionState";
import SearchConnectionPicker from "./SearchConnectionPicker";
import "./SearchExplorer.css";

function SearchExplorer() {
  const { t } = useI18n();
  const connection = useConnectionState(); // Re-renders while connect() flips connecting/connected state, and for the picker's live profile list.
  const selection = useSearchConnectionSelection();
  // Term/results/status/the in-flight search itself all live in SearchSessionStateService, not
  // component state — Sidebar.tsx only mounts this component while the Search tab is active, so
  // local state (or a search kicked off from a component-scoped callback) would reset/get
  // silently abandoned the moment the user switched to another sidebar tab and back mid-search.
  const { term, results, statusMessage } = useSearchSessionState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const connectionsButtonRef = useRef<HTMLButtonElement>(null);

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
      </div>

      {statusMessage ? (
        <div className="search-explorer__status" role="status">
          <Codicon name="loading" />
          <span>{statusMessage}</span>
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
    </div>
  );
}

export default SearchExplorer;
