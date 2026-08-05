export type AiConnectionContext = {
  connected: boolean;
  profileName?: string;
  driverId?: string;
  dialectLabel?: string;
  catalog?: string;
  defaultSchema?: string;
};

export type AiContextHostAdapter = {
  getConnectionContext: () => AiConnectionContext | null;
  /** Truncated schema/object summary from Explorer cache (no network). */
  getSchemaSummaryText: (maxChars: number) => string | null;
  /** Recent executed SQL snippets. */
  getRecentQueryHistoryText: (
    maxChars: number,
    maxEntries: number,
  ) => string | null;
  /**
   * Open PL/SQL object tabs: source + compile-time dependencies + referenced
   * table/view columns. May hit the DB (async). Default: none.
   */
  getOpenPlsqlContextText?: (maxChars: number) => Promise<string | null>;
};

const emptyAdapter: AiContextHostAdapter = {
  getConnectionContext: () => null,
  getSchemaSummaryText: () => null,
  getRecentQueryHistoryText: () => null,
};

let adapter: AiContextHostAdapter = emptyAdapter;

export function configureAiContextHost(next: AiContextHostAdapter): void {
  adapter = next;
}

export const AiContextHost = {
  getConnectionContext(): AiConnectionContext | null {
    return adapter.getConnectionContext();
  },
  getSchemaSummaryText(maxChars: number): string | null {
    return adapter.getSchemaSummaryText(maxChars);
  },
  getRecentQueryHistoryText(
    maxChars: number,
    maxEntries: number,
  ): string | null {
    return adapter.getRecentQueryHistoryText(maxChars, maxEntries);
  },
  async getOpenPlsqlContextText(maxChars: number): Promise<string | null> {
    if (!adapter.getOpenPlsqlContextText) return null;
    try {
      return await adapter.getOpenPlsqlContextText(maxChars);
    } catch {
      return null;
    }
  },
};
