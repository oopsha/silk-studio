import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { CommandService } from "../../../platform/commands/commandService";
import { useConfiguration } from "../../../platform/configuration/useConfiguration";
import { AI_PROVIDER_LABELS } from "../../../services/settings/aiSettingsConstants";
import { AiChatService } from "../../../services/ai/aiChatService";
import type { AiChatUiMessage } from "../../../services/ai/aiChatTypes";
import { AiSqlProposalHost } from "../../../services/ai/aiSqlProposalHost";
import { extractSqlFromMarkdown } from "../../../services/ai/extractSqlFromMarkdown";
import { useAiChat } from "../../../services/ai/useAiChat";
import { useAiReadyState } from "../../../services/ai/useAiReadyState";
import "./SecondarySidebar.css";

function previewSql(sql: string): string {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  return oneLine.length > 96 ? `${oneLine.slice(0, 95)}…` : oneLine;
}

function ProposedSqlActions({ message }: { message: AiChatUiMessage }) {
  if (message.role !== "assistant" || message.status !== "done") {
    return null;
  }

  const blocks = extractSqlFromMarkdown(message.content);
  if (blocks.length === 0) return null;

  return (
    <div className="secondary-sidebar__proposals">
      {blocks.map((sql, index) => {
        const risk = AiSqlProposalHost.getSqlRisk(sql);
        const key = `${message.id}-sql-${index}`;
        return (
          <div key={key} className="secondary-sidebar__proposal">
            <div className="secondary-sidebar__proposal-meta">
              <span className="secondary-sidebar__proposal-label">
                SQL{blocks.length > 1 ? ` ${index + 1}` : ""}
              </span>
              {risk.isWrite ? (
                <span
                  className="secondary-sidebar__proposal-badge"
                  title={
                    risk.readOnly
                      ? "Write/DDL detected; read-only mode will block execution later"
                      : "Write/DDL detected — review before inserting"
                  }
                >
                  Write
                </span>
              ) : null}
            </div>
            <div className="secondary-sidebar__proposal-preview" title={sql}>
              {previewSql(sql)}
            </div>
            <div className="secondary-sidebar__proposal-actions">
              <button
                type="button"
                className="secondary-sidebar__proposal-button"
                title="Review Diff, then Insert or Open in New Tab"
                onClick={() => AiSqlProposalHost.reviewProposedSql(sql)}
              >
                <Codicon name="diff" />
                Review…
              </button>
              <button
                type="button"
                className="secondary-sidebar__proposal-button"
                title="Copy SQL"
                onClick={() => void AiSqlProposalHost.copyProposedSql(sql)}
              >
                <Codicon name="copy" />
                Copy
              </button>
              {risk.allowExecute ? (
                <button
                  type="button"
                  className="secondary-sidebar__proposal-button secondary-sidebar__proposal-button--execute"
                  title={
                    risk.readOnly && risk.isWrite
                      ? "Blocked by database.readOnly (write/DDL)"
                      : "Confirm, then execute against the connected database"
                  }
                  disabled={risk.readOnly && risk.isWrite}
                  onClick={() => void AiSqlProposalHost.executeProposedSql(sql)}
                >
                  <Codicon name="play" />
                  Execute…
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SecondarySidebar() {
  const configuration = useConfiguration();
  const ready = useAiReadyState();
  const chat = useAiChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const provider = configuration["ai.provider"];
  const model = configuration["ai.model"];
  const canSend = ready.ready && !chat.streaming && draft.trim().length > 0;

  useEffect(() => {
    return AiChatService.onDidRequestFocus(() => {
      inputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chat.messages, chat.streaming]);

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const text = draft;
    setDraft("");
    await AiChatService.sendMessage(text);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <aside className="secondary-sidebar" aria-label="AI Chat">
      <header className="secondary-sidebar__header">
        <span className="secondary-sidebar__title">
          <Codicon name="comment-discussion" />
          AI Chat
        </span>
        <div className="secondary-sidebar__header-actions">
          <button
            type="button"
            className="secondary-sidebar__icon-button"
            title="New chat"
            aria-label="New chat"
            disabled={chat.streaming || chat.messages.length === 0}
            onClick={() => AiChatService.clearSession()}
          >
            <Codicon name="add" />
          </button>
          <button
            type="button"
            className="secondary-sidebar__icon-button"
            title="Open AI Settings"
            aria-label="Open AI Settings"
            onClick={() =>
              void CommandService.executeCommand(
                "workbench.action.openAiSettings",
              )
            }
          >
            <Codicon name="settings-gear" />
          </button>
        </div>
      </header>

      <div className="secondary-sidebar__meta">
        {ready.ready
          ? `${AI_PROVIDER_LABELS[provider]} · ${model}`
          : ready.message}
      </div>

      <div ref={listRef} className="secondary-sidebar__messages" role="log">
        {chat.messages.length === 0 ? (
          <div className="secondary-sidebar__empty">
            <p>
              Ask a question about SQL or your database. Multi-turn chat uses
              your configured provider and model.
            </p>
            {!ready.ready ? (
              <button
                type="button"
                className="secondary-sidebar__settings-button"
                onClick={() =>
                  void CommandService.executeCommand(
                    "workbench.action.openAiSettings",
                  )
                }
              >
                Open AI Settings
              </button>
            ) : null}
          </div>
        ) : (
          chat.messages.map((message) => (
            <div
              key={message.id}
              className={`secondary-sidebar__message secondary-sidebar__message--${message.role}${
                message.status === "error"
                  ? " secondary-sidebar__message--error"
                  : ""
              }`}
            >
              <div className="secondary-sidebar__message-role">
                {message.role === "user" ? "You" : "Assistant"}
                {message.status === "streaming" ? " · …" : ""}
              </div>
              <div className="secondary-sidebar__message-body">
                {message.content ||
                  (message.status === "streaming" ? "Thinking…" : "")}
              </div>
              <ProposedSqlActions message={message} />
            </div>
          ))
        )}
      </div>

      {chat.error && chat.messages.every((m) => m.status !== "error") ? (
        <div className="secondary-sidebar__banner" role="alert">
          {chat.error}
        </div>
      ) : null}

      <form className="secondary-sidebar__composer" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="secondary-sidebar__input"
          rows={3}
          placeholder={
            ready.ready
              ? "Ask anything… (Enter to send, Shift+Enter for newline)"
              : "Configure AI in Settings to chat"
          }
          value={draft}
          disabled={!ready.ready || chat.streaming}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="secondary-sidebar__composer-actions">
          {chat.streaming ? (
            <button
              type="button"
              className="secondary-sidebar__send-button"
              onClick={() => AiChatService.cancel()}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="secondary-sidebar__send-button"
              disabled={!canSend}
            >
              Send
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}

export default SecondarySidebar;
