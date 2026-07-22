import { CommandService } from "../../../platform/commands/commandService";
import { useConfiguration } from "../../../platform/configuration/useConfiguration";
import {
  AI_PROVIDER_LABELS,
} from "../../../services/settings/aiSettingsConstants";
import "./SecondarySidebar.css";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";

function SecondarySidebar() {
  const configuration = useConfiguration();
  const enabled = configuration["ai.enabled"];
  const provider = configuration["ai.provider"];
  const model = configuration["ai.model"];
  const hasApiKey = configuration["ai.apiKey"].trim().length > 0;

  let statusMessage = "AI assistant will appear here.";
  if (!enabled) {
    statusMessage = "AI assistant is disabled. Enable it in Settings.";
  } else if (!hasApiKey) {
    statusMessage = "Configure an API key in Settings to use AI Chat.";
  } else if (model.trim().length === 0) {
    statusMessage = "Choose a model in Settings to use AI Chat.";
  } else {
    statusMessage = `${AI_PROVIDER_LABELS[provider]} · ${model}. Chat UI is coming in a later release.`;
  }

  return (
    <aside className="secondary-sidebar" aria-label="AI Chat">
      <header className="secondary-sidebar__header">
        <span className="secondary-sidebar__title">
          <Codicon name="comment-discussion" />
          AI Chat
        </span>
      </header>
      <div className="secondary-sidebar__content">
        <p className="secondary-sidebar__placeholder">{statusMessage}</p>
        <button
          type="button"
          className="secondary-sidebar__settings-button"
          onClick={() => void CommandService.executeCommand("workbench.action.openAiSettings")}
        >
          Open AI Settings
        </button>
      </div>
    </aside>
  );
}

export default SecondarySidebar;
