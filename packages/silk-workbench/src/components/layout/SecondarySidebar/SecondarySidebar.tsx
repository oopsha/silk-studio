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
import { useI18n } from "../../../platform/i18n/useI18n";
import { AI_PROVIDER_LABELS } from "../../../services/settings/aiSettingsConstants";
import { AiChatService } from "../../../services/ai/aiChatService";
import { useAiChat } from "../../../services/ai/useAiChat";
import { useAiReadyState } from "../../../services/ai/useAiReadyState";
import { AiChatMarkdown } from "./AiChatMarkdown";
import "./SecondarySidebar.css";

function SecondarySidebar() {
  const { t } = useI18n();
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
    <aside
      className="secondary-sidebar"
      aria-label={t("workbench.secondarySidebar.aiChat")}
    >
      <header className="secondary-sidebar__header">
        <span className="secondary-sidebar__title">
          <Codicon name="comment-discussion" />
          {t("workbench.secondarySidebar.aiChat")}
        </span>
        <div className="secondary-sidebar__header-actions">
          <button
            type="button"
            className="secondary-sidebar__icon-button"
            title={t("app.ai.usage")}
            aria-label={t("app.ai.usage")}
            onClick={() =>
              void CommandService.executeCommand("silk.ai.showCallLog")
            }
          >
            <Codicon name="graph" />
          </button>
          <button
            type="button"
            className="secondary-sidebar__icon-button"
            title={t("workbench.secondarySidebar.newChat")}
            aria-label={t("workbench.secondarySidebar.newChat")}
            disabled={chat.streaming || chat.messages.length === 0}
            onClick={() => AiChatService.clearSession()}
          >
            <Codicon name="add" />
          </button>
          <button
            type="button"
            className="secondary-sidebar__icon-button"
            title={t("workbench.secondarySidebar.openAiSettings")}
            aria-label={t("workbench.secondarySidebar.openAiSettings")}
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
            <p>{t("app.ai.emptyHint")}</p>
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
                {t("workbench.secondarySidebar.openAiSettings")}
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
                {message.role === "user" ? t("app.ai.you") : t("app.ai.assistant")}
                {message.status === "streaming" ? " · …" : ""}
              </div>
              <div className="secondary-sidebar__message-body">
                {message.status === "error" ? (
                  <div className="secondary-sidebar__message-error">
                    <p className="secondary-sidebar__message-error-summary">
                      {t("app.ai.requestFailed")}
                    </p>
                    {message.content ? (
                      <>
                        <p className="secondary-sidebar__message-error-label">
                          {t("app.ai.errorDetails")}
                        </p>
                        <AiChatMarkdown content={message.content} />
                      </>
                    ) : null}
                  </div>
                ) : message.content ? (
                  <AiChatMarkdown
                    content={message.content}
                    showSqlActions={
                      message.role === "assistant" && message.status === "done"
                    }
                  />
                ) : message.status === "streaming" ? (
                  t("app.ai.thinking")
                ) : (
                  ""
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {chat.error && chat.messages.every((m) => m.status !== "error") ? (
        <div className="secondary-sidebar__banner" role="alert">
          <div className="secondary-sidebar__banner-summary">
            {t("app.ai.requestFailed")}
          </div>
          <div className="secondary-sidebar__banner-details">
            <span className="secondary-sidebar__banner-details-label">
              {t("app.ai.errorDetails")}
            </span>
            {chat.error}
          </div>
        </div>
      ) : null}

      <form className="secondary-sidebar__composer" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="secondary-sidebar__input"
          rows={3}
          placeholder={
            ready.ready
              ? t("app.ai.placeholderReady")
              : t("app.ai.placeholderDisabled")
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
              {t("app.ai.stop")}
            </button>
          ) : (
            <button
              type="submit"
              className="secondary-sidebar__send-button"
              disabled={!canSend}
            >
              {t("app.ai.send")}
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}

export default SecondarySidebar;
