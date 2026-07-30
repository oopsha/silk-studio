export type AiSqlProposalRisk = {
  isWrite: boolean;
  readOnly: boolean;
  allowExecute: boolean;
};

export type AiSqlProposalHostAdapter = {
  /** Open review dialog; editor changes only after the user confirms. */
  reviewProposedSql: (sql: string) => void;
  copyProposedSql: (sql: string) => void | Promise<void>;
  /**
   * Open execute confirmation. Runs SQL only after confirm, then asks the
   * chat to interpret the outcome. No-op when allowExecute is false.
   */
  executeProposedSql: (sql: string) => void | Promise<void>;
  getSqlRisk: (sql: string) => AiSqlProposalRisk;
};

const emptyAdapter: AiSqlProposalHostAdapter = {
  reviewProposedSql: () => {
    console.warn("AiSqlProposalHost is not configured.");
  },
  copyProposedSql: async (sql) => {
    try {
      await navigator.clipboard.writeText(sql);
    } catch {
      // Ignore clipboard failures in unconfigured hosts.
    }
  },
  executeProposedSql: () => {
    console.warn("AiSqlProposalHost is not configured.");
  },
  getSqlRisk: () => ({
    isWrite: false,
    readOnly: false,
    allowExecute: false,
  }),
};

let adapter: AiSqlProposalHostAdapter = emptyAdapter;

export function configureAiSqlProposalHost(
  next: AiSqlProposalHostAdapter,
): void {
  adapter = next;
}

export const AiSqlProposalHost = {
  reviewProposedSql(sql: string): void {
    adapter.reviewProposedSql(sql);
  },
  copyProposedSql(sql: string): void | Promise<void> {
    return adapter.copyProposedSql(sql);
  },
  executeProposedSql(sql: string): void | Promise<void> {
    return adapter.executeProposedSql(sql);
  },
  getSqlRisk(sql: string): AiSqlProposalRisk {
    return adapter.getSqlRisk(sql);
  },
};
