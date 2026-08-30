import { bridgeFindObjectsByName } from "../connection/connectionBridge";
import { ConnectionService } from "../connection/connectionService";
import {
  buildLiveSearchResultPick,
  type ExplorerObjectSearchPick,
} from "../connection/explorerSearchItems";
import { runWithConcurrency } from "../connection/explorerSearchPrefetchService";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { SearchConnectionSelectionService } from "./searchConnectionSelectionService";
import { SearchKindSelectionService } from "./searchKindSelectionService";

/** Below this, a substring scan across every connection is more noise than signal. */
export const MIN_SEARCH_TERM_LENGTH = 2;
/** Concurrency cap for per-profile live searches, once every profile is connected. */
const SEARCH_CONCURRENCY = 3;

export type SearchSessionState = {
  term: string;
  results: ExplorerObjectSearchPick[] | null;
  statusMessage: string | null;
  /**
   * Names of connections whose search failed or timed out this run (see
   * `FIND_OBJECTS_TIMEOUT_SECONDS` on the jdbc-agent side) — `results` may be missing real
   * matches from these, silently, unless this is surfaced. `null` once a new search starts.
   */
  failedProfileNames: string[] | null;
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
  private state: SearchSessionState = {
    term: "",
    results: null,
    statusMessage: null,
    failedProfileNames: null,
  };
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

  /**
   * Abandons the in-flight search the same way a new search supersedes it (bump `generation` so
   * every `if (this.generation !== generation) return;` check below trips on its next await) —
   * this doesn't reach into the JDBC agent to cancel the underlying query (per-profile searches
   * are independent HTTP-ish round trips, not something the client holds a cancellable handle
   * to), so an already-issued query keeps running server-side until it finishes or hits its own
   * `FIND_OBJECTS_TIMEOUT_SECONDS` bound — but the UI stops waiting on it immediately, and its
   * result (whenever it does arrive) is silently discarded instead of clobbering whatever the
   * user searches for next.
   */
  cancelSearch(): void {
    this.generation += 1;
    this.setState({ statusMessage: null });
  }

  async runSearch(term: string): Promise<void> {
    const trimmed = term.trim();
    if (trimmed.length < MIN_SEARCH_TERM_LENGTH) return;

    this.generation += 1;
    const generation = this.generation;
    this.setState({ results: null, failedProfileNames: null });

    // An empty kind selection can only ever match nothing — short-circuit locally rather than
    // asking the bridge to search with no kinds (which, since an *absent* `kinds` field means
    // "no filter" for every other caller of this RPC, would otherwise search every kind instead
    // of the zero the user actually asked for).
    const kinds = Array.from(SearchKindSelectionService.getSelection());
    if (kinds.length === 0) {
      this.setState({ results: [], statusMessage: null });
      return;
    }

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

    const connectedProfiles = candidateProfiles.filter((profile) =>
      ConnectionService.isConnected(profile.id),
    );
    // `selection === null` is "every profile" (see SearchConnectionSelectionService) — matches
    // the same wording the connections-picker button itself uses, rather than always claiming
    // "all connections" even when the user narrowed it down to one.
    this.setState({
      statusMessage:
        selection === null
          ? I18nService.t("app.search.searching")
          : I18nService.t("app.search.searchingCount").replace(
              "{n}",
              String(connectedProfiles.length),
            ),
    });
    const showLabels = connectedProfiles.length > 1;
    const found: ExplorerObjectSearchPick[] = [];
    const failedProfileNames: string[] = [];

    // Publishes whatever's accumulated in `found`/`failedProfileNames` so far — called after each
    // profile's search settles (not just once at the very end), so results from a fast connection
    // show up immediately instead of waiting on a slow/timed-out one. `statusMessage` is left
    // alone here (still "searching…" until every profile is done) — only the final call below
    // clears it, since results and the "still searching" spinner are meant to render together.
    const publish = () => {
      if (this.generation !== generation) return;
      const sorted = [...found].sort((a, b) => {
        const byLabel = a.label.localeCompare(b.label);
        if (byLabel !== 0) return byLabel;
        return a.description.localeCompare(b.description);
      });
      this.setState({
        results: sorted,
        failedProfileNames: failedProfileNames.length > 0 ? [...failedProfileNames] : null,
      });
    };

    await runWithConcurrency(connectedProfiles, SEARCH_CONCURRENCY, async (profile) => {
      try {
        const response = await bridgeFindObjectsByName(profile.id, trimmed, {
          contains: true,
          kinds,
          // Mirrors the Explorer's own per-profile "show system objects" toggle — on a database
          // with large built-in schemas (Oracle Autonomous Database's APEX workspace metadata
          // alone can be tens of thousands of rows), searching those is often the difference
          // between finishing well inside the timeout and not finishing at all.
          includeSystemObjects: profile.showSystemObjects,
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
        if (response.partial) {
          // A catalog-explorer dialect (SQL Server) with one catalog timing out — every other
          // catalog's results are already in `found` above, but this profile's results may still
          // be missing rows from the one(s) that didn't finish, so it's flagged the same as an
          // outright failure.
          failedProfileNames.push(profile.name);
        }
      } catch {
        // Best-effort across connections — one profile failing/timing out (the jdbc-agent caps
        // each query at FIND_OBJECTS_TIMEOUT_SECONDS) shouldn't blank the results from every
        // other connection, or leave the search stuck waiting on it — but it's surfaced below
        // (failedProfileNames) rather than silently swallowed, since real matches may be missing
        // from `results` for exactly this profile.
        failedProfileNames.push(profile.name);
      }
      publish();
    });

    if (this.generation !== generation) return;
    this.setState({ statusMessage: null });
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
