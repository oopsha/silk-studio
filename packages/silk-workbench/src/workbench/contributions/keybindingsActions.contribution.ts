import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsEditorService } from "../../services/keybindings/keybindingsEditorService";

CommandsRegistry.registerCommand(
  "workbench.action.openGlobalKeybindings",
  () => {
    KeybindingsEditorService.openKeybindings();
  },
);
