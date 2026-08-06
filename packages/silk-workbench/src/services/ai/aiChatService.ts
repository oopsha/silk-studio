import {
  AiProviderError,
  type AiTokenUsage,
} from "./aiProviderTypes";
import { AiAuditLogService } from "./aiAuditLogService";
import { buildAiSystemPrompt } from "./aiContextService";
import {
  completeConfiguredTurn,
  getAiReadyState,
  streamConfiguredChat,
} from "./aiProviderService";
import { ConfigurationService } from "../../platform/configuration/configurationService";
import { I18nService } from "../../platform/i18n/i18nService";
import type { AiChatSessionState, AiChatUiMessage } from "./aiChatTypes";
import { AiToolHost } from "./aiToolHost";
import type { AiWireMessage } from "./aiToolTypes";

const STORAGE_KEY = "silk-db-studio.aiChat.session.v1";
const MAX_TOOL_ROUNDS = 6;

type AiChatListener = () => void;
type FocusListener = () => void;

function createId(): string {
  return crypto.randomUUID();
}

function loadPersistedMessages(): AiChatUiMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is AiChatUiMessage =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as AiChatUiMessage).id === "string" &&
          ((item as AiChatUiMessage).role === "user" ||
            (item as AiChatUiMessage).role === "assistant") &&
          typeof (item as AiChatUiMessage).content === "string",
      )
      .map((item) => ({
        ...item,
        status: item.status === "error" ? "error" : "done",
      }));
  } catch {
    return [];
  }
}

function persistMessages(messages: AiChatUiMessage[]): void {
  try {
    const durable = messages.filter((message) => message.status !== "streaming");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(durable));
  } catch {
    // Quota / private mode — ignore.
  }
}

function mergeUsage(
  current: AiTokenUsage | undefined,
  next: AiTokenUsage | undefined,
): AiTokenUsage | undefined {
  if (!current && !next) return undefined;
  return {
    inputTokens: (current?.inputTokens ?? 0) + (next?.inputTokens ?? 0) || undefined,
    outputTokens:
      (current?.outputTokens ?? 0) + (next?.outputTokens ?? 0) || undefined,
  };
}

function formatToolStatus(names: string[]): string {
  const unique = [...new Set(names)];
  return `${I18nService.t("app.ai.usingTools")}: ${unique.join(", ")}`;
}

/** True when the bubble still shows the in-progress tool placeholder, not a real reply. */
function isToolStatusContent(content: string): boolean {
  const prefix = `${I18nService.t("app.ai.usingTools")}:`;
  return content.trimStart().startsWith(prefix);
}

/**
 * On failure/cancel, keep a real partial answer but replace the "Using tools: …"
 * placeholder so the bubble shows the actual outcome instead of looking stuck.
 */
function resolveFailureContent(currentContent: string, fallback: string): string {
  const trimmed = currentContent.trim();
  if (!trimmed || isToolStatusContent(trimmed)) {
    return fallback;
  }
  return currentContent;
}

class AiChatServiceImpl {
  private messages: AiChatUiMessage[] = loadPersistedMessages();
  private streaming = false;
  private error: string | null = null;
  private abortController: AbortController | null = null;
  private readonly listeners = new Set<AiChatListener>();
  private readonly focusListeners = new Set<FocusListener>();

  getState(): AiChatSessionState {
    return {
      messages: this.messages,
      streaming: this.streaming,
      error: this.error,
    };
  }

  onDidChange(listener: AiChatListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDidRequestFocus(listener: FocusListener): () => void {
    this.focusListeners.add(listener);
    return () => this.focusListeners.delete(listener);
  }

  requestFocus(): void {
    for (const listener of this.focusListeners) {
      listener();
    }
  }

  clearSession(): void {
    this.cancel();
    this.messages = [];
    this.error = null;
    persistMessages(this.messages);
    this.fireDidChange();
  }

  cancel(): void {
    if (!this.abortController) return;
    this.abortController.abort();
    this.abortController = null;
  }

  /** Append a finished assistant note without calling the provider. */
  appendLocalAssistantMessage(content: string): void {
    const text = content.trim();
    if (!text) return;
    this.messages = [
      ...this.messages,
      {
        id: createId(),
        role: "assistant",
        content: text,
        status: "done",
      },
    ];
    persistMessages(this.messages);
    this.fireDidChange();
    this.requestFocus();
  }

  /**
   * After a confirmed SQL run: ask the model to interpret the outcome.
   * Falls back to a local note when AI is unavailable or already streaming.
   */
  async interpretExecutionOutcome(report: string): Promise<void> {
    const text = report.trim();
    if (!text) return;

    const ready = getAiReadyState();
    if (!ready.ready) {
      this.appendLocalAssistantMessage(
        `Execution finished.\n\n${text}\n\n(AI interpretation unavailable: ${ready.message})`,
      );
      return;
    }

    if (this.streaming) {
      this.appendLocalAssistantMessage(`Execution finished.\n\n${text}`);
      return;
    }

    await this.sendMessage(text);
  }

  async sendMessage(text: string): Promise<void> {
    const content = text.trim();
    if (!content || this.streaming) return;

    const ready = getAiReadyState();
    if (!ready.ready) {
      this.error = ready.message;
      this.fireDidChange();
      return;
    }

    const userMessage: AiChatUiMessage = {
      id: createId(),
      role: "user",
      content,
      status: "done",
    };
    const assistantMessage: AiChatUiMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      status: "streaming",
    };

    this.messages = [...this.messages, userMessage, assistantMessage];
    this.streaming = true;
    this.error = null;
    this.fireDidChange();

    const controller = new AbortController();
    this.abortController = controller;
    const startedAt = performance.now();
    const provider = ConfigurationService.getValue("ai.provider");
    const model = ConfigurationService.getValue("ai.model").trim();
    let usage: AiTokenUsage | undefined;
    let auditStatus: "success" | "error" | "cancelled" = "success";
    let errorCode: AiProviderError["code"] | undefined;

    try {
      const tools = AiToolHost.getTools();
      if (tools.length === 0) {
        const history = [
          { role: "system" as const, content: await buildAiSystemPrompt() },
          ...this.messages
            .filter(
              (message) =>
                message.id !== assistantMessage.id &&
                message.content.trim().length > 0 &&
                message.status !== "error",
            )
            .map((message) => ({
              role: message.role,
              content: message.content,
            })),
        ];
        for await (const chunk of streamConfiguredChat(history, {
          signal: controller.signal,
        })) {
          if (chunk.text) {
            this.patchAssistant(assistantMessage.id, (current) => ({
              ...current,
              content: current.content + chunk.text,
            }));
          }
          if (chunk.usage) {
            usage = chunk.usage;
          }
        }
      } else {
        const wire: AiWireMessage[] = [
          { role: "system", content: await buildAiSystemPrompt() },
          ...this.messages
            .filter(
              (message) =>
                message.id !== assistantMessage.id &&
                message.content.trim().length > 0 &&
                message.status !== "error",
            )
            .map((message) => ({
              role: message.role as "user" | "assistant",
              content: message.content,
            })),
        ];

        let finalText = "";
        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
          const turn = await completeConfiguredTurn(wire, {
            signal: controller.signal,
            tools,
          });
          usage = mergeUsage(usage, turn.usage);

          if (turn.toolCalls && turn.toolCalls.length > 0) {
            this.patchAssistant(assistantMessage.id, (current) => ({
              ...current,
              content: formatToolStatus(turn.toolCalls!.map((call) => call.name)),
            }));

            wire.push({
              role: "assistant",
              content: turn.text,
              toolCalls: turn.toolCalls,
            });

            for (const call of turn.toolCalls) {
              if (controller.signal.aborted) {
                throw new AiProviderError("Request cancelled.", {
                  code: "cancelled",
                  provider,
                });
              }
              let result: string;
              try {
                result = await AiToolHost.executeTool(
                  call.name,
                  call.arguments,
                  controller.signal,
                );
              } catch (error) {
                result = JSON.stringify({
                  error:
                    error instanceof Error
                      ? error.message
                      : "Tool execution failed.",
                });
              }
              wire.push({
                role: "tool",
                toolCallId: call.id,
                name: call.name,
                content: result,
              });
            }
            continue;
          }

          finalText = turn.text;
          break;
        }

        if (!finalText.trim()) {
          // Last resort: one more turn without tools if the model only called tools.
          const turn = await completeConfiguredTurn(wire, {
            signal: controller.signal,
          });
          usage = mergeUsage(usage, turn.usage);
          finalText = turn.text;
        }

        this.patchAssistant(assistantMessage.id, (current) => ({
          ...current,
          content: finalText.trim()
            ? finalText
            : I18nService.t("app.ai.emptyToolResponse"),
        }));
      }

      this.patchAssistant(assistantMessage.id, (current) => ({
        ...current,
        status: "done",
      }));
    } catch (error) {
      const cancelled =
        (error instanceof AiProviderError && error.code === "cancelled") ||
        controller.signal.aborted;

      if (cancelled) {
        auditStatus = "cancelled";
        errorCode = "cancelled";
        this.patchAssistant(assistantMessage.id, (current) => {
          const content = resolveFailureContent(current.content, "Cancelled.");
          const keptPartial =
            content === current.content && current.content.trim().length > 0;
          return {
            ...current,
            status: keptPartial ? "done" : "error",
            error: keptPartial ? undefined : "Cancelled.",
            content,
          };
        });
      } else {
        auditStatus = "error";
        errorCode =
          error instanceof AiProviderError ? error.code : "unknown";
        const message =
          error instanceof Error
            ? error.message
            : "Failed to get a response from the AI provider.";
        this.error = message;
        this.patchAssistant(assistantMessage.id, (current) => ({
          ...current,
          status: "error",
          error: message,
          content: resolveFailureContent(current.content, message),
        }));
      }
    } finally {
      AiAuditLogService.record({
        kind: "chat",
        provider,
        model,
        status: auditStatus,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        errorCode,
        durationMs: Math.round(performance.now() - startedAt),
      });

      if (this.abortController === controller) {
        this.abortController = null;
      }
      this.streaming = false;
      persistMessages(this.messages);
      this.fireDidChange();
    }
  }

  private patchAssistant(
    id: string,
    update: (current: AiChatUiMessage) => AiChatUiMessage,
  ): void {
    this.messages = this.messages.map((message) =>
      message.id === id ? update(message) : message,
    );
    this.fireDidChange();
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const AiChatService = new AiChatServiceImpl();
