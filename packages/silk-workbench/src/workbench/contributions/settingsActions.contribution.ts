import { CommandsRegistry } from "../../platform/commands/commandRegistry";
import { KeybindingsRegistry } from "../../platform/keybinding/keybindingRegistry";
import { SettingsService } from "../../services/settings/settingsService";
import { ConfigurationService } from "../../platform/configuration/configurationService";

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

CommandsRegistry.registerCommand("editor.action.toggleMinimap", () => {
  ConfigurationService.updateValue(
    "editor.minimap.enabled",
    !ConfigurationService.getValue("editor.minimap.enabled"),
  );
});

CommandsRegistry.registerCommand("editor.action.toggleStickyScroll", () => {
  ConfigurationService.updateValue(
    "editor.stickyScroll.enabled",
    !ConfigurationService.getValue("editor.stickyScroll.enabled"),
  );
});

CommandsRegistry.registerCommand("editor.action.toggleWordWrap", () => {
  ConfigurationService.updateValue(
    "editor.wordWrap",
    ConfigurationService.getValue("editor.wordWrap") === "on" ? "off" : "on",
  );
});

KeybindingsRegistry.registerKeybinding("editor.action.toggleWordWrap", "Alt+Z");
