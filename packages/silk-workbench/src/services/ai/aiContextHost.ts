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
};
