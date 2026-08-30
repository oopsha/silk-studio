import { bridgeFindObjectsByName } from "../connection/connectionBridge";
import { ConnectionService } from "../connection/connectionService";
import {
  buildLiveSearchResultPick,
  type ExplorerObjectSearchPick,
} from "../connection/explorerSearchItems";
import { runWithConcurrency } from "../connection/explorerSearchPrefetchService";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { SearchConnectionSelectionService } from "./searchConnectionSelectionService";

/** Below this, a substring scan across every connection is more noise than signal. */
export const MIN_SEARCH_TERM_LENGTH = 2;
/** Concurrency cap for per-profile live searches, once every profile is connected. */
const SEARCH_CONCURRENCY = 3;

export type SearchSessionState = {
  term: string;
  results: ExplorerObjectSearchPick[] | null;
  statusMessage: string | null;
};

type SearchSessionListener = () => void;

/**
 * Owns the Search sidebar's term/results/status — and, critically, runs the search itself —
 * outside of `SearchExplorer.tsx`. `Sidebar.tsx` only mounts that component while the Search tab
 * is active, so a `useState`/`useCallback`-based search would silently reset (or, worse, keep
 * writing to setters on an already-unmounted component that just get dropped) the moment the
 * user switched to another sidebar tab and back mid-search. Living here instead means an
 * in-flight search survives that switch exactly like `ConnectionService`'s own connect-in-
 * progress state does, and the component just re-subscribes to whatever's already there.
 */
class SearchSessionStateServiceImpl {
  private state: SearchSessionState = { term: "", results: null, statusMessage: null };
  // Monotonic "search generation" — bumped on every new search (re-click/re-Enter) so a slow,
  // superseded run (still connecting profiles, or still awaiting search responses) is silently
  // abandoned instead of clobbering a newer search's results.
  private generation = 0;
  private readonly listeners = new Set<SearchSessionListener>();

  getState(): SearchSessionState {
    return this.state;
  }

  setTerm(term: string): void {
    this.setState({ term });
  }

  async runSearch(term: string): Promise<void> {
    const trimmed = term.trim();
    if (trimmed.length < MIN_SEARCH_TERM_LENGTH) return;

    this.generation += 1;
    const generation = this.generation;
    this.setState({ results: null });

    const selection = SearchConnectionSelectionService.getSelection();
    const candidateProfiles = ConnectionService.getState().profiles.filter(
      (profile) => selection === null || selection.has(profile.id),
    );
    const disconnectedProfiles = candidateProfiles.filter(
      (profile) => !ConnectionService.isConnected(profile.id),
    );

    // Connect disconnected profiles one at a time, exactly as if the user had clicked Connect
    // on each themselves (password prompts included) — ConnectionPasswordPromptService only
    // holds a single pending request, so connecting several profiles concurrently would cancel
    // all but the last prompt.
    for (const profile of disconnectedProfiles) {
      if (this.generation !== generation) return;
      this.setState({
        statusMessage: I18nService.t("app.search.connecting").replace("{name}", profile.name),
      });
      try {
        await ConnectionService.connect(profile.id);
      } catch {
        // Best-effort — a profile that fails to connect (or whose password prompt was
        // cancelled) just doesn't contribute results, the search continues for the rest.
      }
    }

    if (this.generation !== generation) return;

    this.setState({ statusMessage: I18nService.t("app.search.searching") });
    const connectedProfiles = candidateProfiles.filter((profile) =>
      ConnectionService.isConnected(profile.id),
    );
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
        // Best-effort across connections — one profile failing/timing out (the jdbc-agent caps
        // each query at FIND_OBJECTS_TIMEOUT_SECONDS) shouldn't blank the results from every
        // other connection, or leave the search stuck waiting on it.
      }
    });

    if (this.generation !== generation) return;

    found.sort((a, b) => {
      const byLabel = a.label.localeCompare(b.label);
      if (byLabel !== 0) return byLabel;
      return a.description.localeCompare(b.description);
    });
    this.setState({ results: found, statusMessage: null });
  }

  onDidChange(listener: SearchSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(partial: Partial<SearchSessionState>): void {
    this.state = { ...this.state, ...partial };
    this.fireDidChange();
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const SearchSessionStateService = new SearchSessionStateServiceImpl();
