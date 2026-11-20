import React from "react";
import ReactDOM from "react-dom/client";
import "@vscode/codicons/dist/codicon.css";
import "@silk-studio/ui/global.css";
import "./style.css";
import App from "./App";
import { WindowTitleService } from "@silk-studio/workbench/services/windowTitle/windowTitleService.ts";
// Registers the title bar centre (back/forward and the search box) shared with the other apps.
import "@silk-studio/workbench/workbench/contributions/titlebar.contribution";
import "@silk-studio/workbench/workbench/contributions/commandPalette.contribution";
import { CommandsRegistry } from "@silk-studio/workbench/platform/commands/commandRegistry.ts";
import { KeybindingsRegistry } from "@silk-studio/workbench/platform/keybinding/keybindingRegistry.ts";
import { hideCommandsFromPalette } from "@silk-studio/workbench/services/commands/commandCatalog.ts";
import { CommandPaletteService } from "@silk-studio/workbench/services/commands/commandPaletteService.ts";

WindowTitleService.setWorkspaceName("Silk Zip");
// The shared quick pick lists database commands, so the title bar box opens the command palette.
CommandsRegistry.registerCommand("workbench.action.quickOpen", () => CommandPaletteService.toggle(), { replace: true });
KeybindingsRegistry.registerKeybinding("workbench.action.showCommands", "Ctrl+Shift+P");
hideCommandsFromPalette("workbench.action.quickOpen", "silkZip.recent.empty");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
