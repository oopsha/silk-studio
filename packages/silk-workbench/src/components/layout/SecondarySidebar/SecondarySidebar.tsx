import { CommandService } from "../../../platform/commands/commandService";
import { useConfiguration } from "../../../platform/configuration/useConfiguration";
import {
  AI_PROVIDER_LABELS,
} from "../../../services/settings/aiSettingsConstants";
import { useAiReadyState } from "../../../services/ai/useAiReadyState";
import "./SecondarySidebar.css";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";

function SecondarySidebar() {
  const configuration = useConfiguration();
  const ready = useAiReadyState();
  const provider = configuration["ai.provider"];
  const model = configuration["ai.model"];

  let statusMessage = "AI assistant will appear here.";
  if (!ready.ready) {
    statusMessage = ready.message;
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
