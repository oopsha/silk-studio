import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { SettingsService } from "../../services/settings/settingsService";

CommandsRegistry.registerCommand("workbench.action.openSettings", () => {
  SettingsService.openSettings("appearance");
});

KeybindingsRegistry.registerKeybinding(
  "workbench.action.openSettings",
  "Ctrl+,",
);

CommandsRegistry.registerCommand("workbench.action.selectTheme", () => {
  SettingsService.openSettings("appearance");
});

CommandsRegistry.registerCommand("workbench.action.configureEditors", () => {
  SettingsService.openSettings("editor");
});

CommandsRegistry.registerCommand("workbench.action.openAiSettings", () => {
  SettingsService.openSettings("ai");
});
