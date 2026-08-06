import { Children, isValidElement, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "../../../platform/i18n/useI18n";
import { openExternalUrl } from "../../../platform/openExternalUrl";
import { AiSqlProposalHost } from "../../../services/ai/aiSqlProposalHost";
import { isSqlCodeFence } from "../../../services/ai/extractSqlFromMarkdown";

type AiChatMarkdownProps = {
  content: string;
  /** Show review/copy(/execute) under SQL fences (assistant messages only). */
  showSqlActions?: boolean;
};

function codeText(children: ReactNode): string {
  return String(children ?? "").replace(/\n$/, "");
}

function fenceLanguage(className: string | undefined): string {
  const match = /language-([^\s]+)/.exec(className ?? "");
  return match?.[1] ?? "";
}

function SqlFenceActions({ sql }: { sql: string }) {
  const { t } = useI18n();
  const risk = AiSqlProposalHost.getSqlRisk(sql);

  return (
    <div className="ai-chat-markdown__sql-actions">
      {risk.isWrite ? (
        <span
          className="ai-chat-markdown__sql-badge"
          title={
            risk.readOnly
              ? t("app.ai.writeBadgeReadonly")
              : t("app.ai.writeBadgeReview")
          }
        >
          {t("app.ai.writeBadge")}
        </span>
      ) : null}
      <div className="ai-chat-markdown__sql-buttons">
        <button
          type="button"
          className="secondary-sidebar__proposal-button"
          title={t("app.ai.reviewTitle")}
          onClick={() => AiSqlProposalHost.reviewProposedSql(sql)}
        >
          <Codicon name="diff" />
          {t("app.ai.review")}
        </button>
        <button
          type="button"
          className="secondary-sidebar__proposal-button"
          title={t("app.ai.copySql")}
          onClick={() => void AiSqlProposalHost.copyProposedSql(sql)}
        >
          <Codicon name="copy" />
          {t("common.copy")}
        </button>
        {risk.allowExecute ? (
          <button
            type="button"
            className="secondary-sidebar__proposal-button secondary-sidebar__proposal-button--execute"
            title={
              risk.readOnly && risk.isWrite
                ? t("app.ai.executeBlockedReadonly")
                : t("app.ai.executeConfirmTitle")
            }
            disabled={risk.readOnly && risk.isWrite}
            onClick={() => void AiSqlProposalHost.executeProposedSql(sql)}
          >
            <Codicon name="play" />
            {t("app.ai.executeEllipsis")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Renders assistant/user chat content as GitHub-flavored Markdown.
 * react-markdown does not evaluate raw HTML by default (safe for chat).
 */
export function AiChatMarkdown({
  content,
  showSqlActions = false,
}: AiChatMarkdownProps) {
  return (
    <div className="ai-chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                event.preventDefault();
                void openExternalUrl(href);
              }}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => {
            const codeChild = Children.toArray(children).find(isValidElement);
            const codeProps =
              isValidElement(codeChild) && codeChild.props
                ? (codeChild.props as {
                    className?: string;
                    children?: ReactNode;
                  })
                : null;
            const language = fenceLanguage(codeProps?.className);
            const sql = codeText(codeProps?.children);
            const showActions =
              showSqlActions && sql.length > 0 && isSqlCodeFence(language, sql);

            return (
              <div className="ai-chat-markdown__fence">
                <pre className="ai-chat-markdown__pre">{children}</pre>
                {showActions ? <SqlFenceActions sql={sql} /> : null}
              </div>
            );
          },
          code: ({ className, children, ...props }) => {
            const text = codeText(children);
            const looksBlock =
              Boolean(className?.includes("language-")) || text.includes("\n");
            if (looksBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="ai-chat-markdown__inline-code" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
