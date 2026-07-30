import { configureAiSqlProposalHost } from "@silk-studio/workbench/services/ai/aiSqlProposalHost.ts";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { isWriteSql } from "../query/sqlGuard";
import { openAiSqlExecuteDialog } from "./openAiSqlExecuteDialog";
import { openAiSqlReviewDialog } from "./openAiSqlReviewDialog";

/** Wire DB Studio insert/diff/copy/execute into the workbench AI chat proposal actions. */
export function configureDbStudioAiSqlProposalHost(): void {
  configureAiSqlProposalHost({
    reviewProposedSql: (sql) => {
      void openAiSqlReviewDialog(sql);
    },
    copyProposedSql: async (sql) => {
      await navigator.clipboard.writeText(sql);
    },
    executeProposedSql: (sql) => {
      void openAiSqlExecuteDialog(sql);
    },
    getSqlRisk: (sql) => ({
      isWrite: isWriteSql(sql),
      readOnly: ConfigurationService.getValue("database.readOnly"),
      allowExecute: ConfigurationService.getValue("ai.allowExecute"),
    }),
  });
}
