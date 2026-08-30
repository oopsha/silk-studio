import { useCallback, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { CommandService } from "@silk-studio/workbench/platform/commands/commandService.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { bridgeFindObjectsByName } from "../../services/connection/connectionBridge";
import { ConnectionService } from "../../services/connection/connectionService";
import {
  defaultObjectAction,
  EXPLORER_COMMANDS,
  type ExplorerObjectRef,
} from "../../services/connection/explorerObjectActions";
import {
  buildLiveSearchResultPick,
  type ExplorerObjectSearchPick,
} from "../../services/connection/explorerSearchItems";
import { runWithConcurrency } from "../../services/connection/explorerSearchPrefetchService";
import { useConnectionState } from "../../services/connection/useConnectionState";
import "./SearchExplorer.css";

/** Below this, a substring scan across every connection is more noise than signal. */
const MIN_SEARCH_TERM_LENGTH = 2;
/** Concurrency cap for per-profile live searches, once every profile is connected. */
const SEARCH_CONCURRENCY = 3;

function SearchExplorer() {
  const { t } = useI18n();
  useConnectionState(); // Re-renders while ConnectionService.connect() below flips connecting/connected state.
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ExplorerObjectSearchPick[] | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Monotonic "search generation" — bumped on every new search (re-click/re-Enter) so a slow,
  // superseded run (still connecting profiles, or still awaiting search responses) is silently
  // abandoned instead of clobbering a newer search's results. Mirrors the same pattern in
  // ExplorerSearchQuickPick.tsx's runLiveSearch.
  const generationRef = useRef(0);

  const runSearch = useCallback(async () => {
    const trimmed = term.trim();
    if (trimmed.length < MIN_SEARCH_TERM_LENGTH) return;

    generationRef.current += 1;
    const generation = generationRef.current;
    setResults(null);

    const disconnectedProfiles = ConnectionService.getState().profiles.filter(
      (profile) => !ConnectionService.isConnected(profile.id),
    );

    // Connect disconnected profiles one at a time, exactly as if the user had clicked Connect
    // on each themselves (password prompts included) — ConnectionPasswordPromptService only
    // holds a single pending request, so connecting several profiles concurrently would cancel
    // all but the last prompt.
    for (const profile of disconnectedProfiles) {
      if (generationRef.current !== generation) return;
      setStatusMessage(t("app.search.connecting").replace("{name}", profile.name));
      try {
        await ConnectionService.connect(profile.id);
      } catch {
        // Best-effort — a profile that fails to connect (or whose password prompt was
        // cancelled) just doesn't contribute results, the search continues for the rest.
      }
    }

    if (generationRef.current !== generation) return;

    setStatusMessage(t("app.search.searching"));
    const connectedProfiles = ConnectionService.getConnectedProfiles();
    const showLabels = connectedProfiles.length > 1;
    const found: ExplorerObjectSearchPick[] = [];
    await runWithConcurrency(connectedProfiles, SEARCH_CONCURRENCY, async (profile) => {
      try {
        const response = await bridgeFindObjectsByName(profile.id, trimmed, {
          contains: true,
        });
        for (const object of response.objects) {
          found.push(
            buildLiveSearchResultPick(
              profile.id,
              showLabels ? profile.name : undefined,
              object,
            ),
          );
        }
      } catch {
        // Best-effort across connections — one profile failing/timing out shouldn't blank the
        // search results from every other connection.
      }
    });

    if (generationRef.current !== generation) return;

    found.sort((a, b) => {
      const byLabel = a.label.localeCompare(b.label);
      if (byLabel !== 0) return byLabel;
      return a.description.localeCompare(b.description);
    });
    setResults(found);
    setStatusMessage(null);
  }, [term, t]);

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
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch();
            }
          }}
        />
        <button
          type="button"
          className="search-explorer__search-button"
          title={t("app.search.searchButton")}
          aria-label={t("app.search.searchButton")}
          disabled={!canSearch}
          onClick={() => void runSearch()}
        >
          <Codicon name="search" />
        </button>
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
