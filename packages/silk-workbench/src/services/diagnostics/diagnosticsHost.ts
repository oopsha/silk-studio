export type DiagnosticsConnectionSummary = {
  status: string;
  profileName?: string;
  driverId?: string;
  /** Never include passwords or full JDBC URLs with credentials. */
  hostHint?: string;
};

export type DiagnosticsHostAdapter = {
  getConnectionSummary: () => DiagnosticsConnectionSummary | null;
};

const emptyAdapter: DiagnosticsHostAdapter = {
  getConnectionSummary: () => null,
};

let adapter: DiagnosticsHostAdapter = emptyAdapter;

export function configureDiagnosticsHost(next: DiagnosticsHostAdapter): void {
  adapter = next;
}

export const DiagnosticsHost = {
  getConnectionSummary(): DiagnosticsConnectionSummary | null {
    return adapter.getConnectionSummary();
  },
};
