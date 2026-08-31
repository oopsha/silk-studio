import React from "react";
import ReactDOM from "react-dom/client";
import { applyWorkbenchFonts } from "@silk-studio/ui/platform/fonts.ts";
import { configureEditorHost } from "@silk-studio/editor/services/editor/editorHost.ts";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import { UserKeybindingsService } from "@silk-studio/workbench/platform/keybinding/userKeybindingsService.ts";
import { WindowTitleService } from "@silk-studio/workbench/services/windowTitle/windowTitleService.ts";
import { AppLogService } from "@silk-studio/workbench/services/diagnostics/appLogService.ts";
import { configureDbStudioAiContextHost } from "./services/ai/configureAiContextHost";
import { configureDbStudioAiSqlProposalHost } from "./services/ai/configureAiSqlProposalHost";
import { configureDbStudioAiToolHost } from "./services/ai/configureAiToolHost";
import { configureDbStudioDiagnosticsHost } from "./services/diagnostics/configureDiagnosticsHost";
import "@silk-studio/ui/global.css";
import "@silk-studio/workbench/workbench/workbench.contribution";
import "./workbench/contributions/queryActions.contribution";
import "./workbench/contributions/queryResultActions.contribution";
import "./workbench/contributions/connectionTarget.contribution";
import "./workbench/contributions/connectionTransaction.contribution";
import "./workbench/contributions/connectionActions.contribution";
import "./workbench/contributions/settingsImportExport.contribution";
import "./workbench/contributions/explorerObjectActions.contribution";
import "./workbench/contributions/goToDefinition.contribution";
import "./workbench/contributions/sqlLanguage.contribution";
import "./workbench/contributions/sqlFormat.contribution";
import "./workbench/contributions/queryHistory.contribution";
import "./workbench/contributions/plsqlSave.contribution";
import "./workbench/contributions/plsqlCompile.contribution";
import "./workbench/contributions/plsqlSnapshot.contribution";
import App from "./App";

// Every *.contribution.ts above has registered its default keybinding by this point (they run
// synchronously at import time) — apply saved user overrides on top of those defaults now.
UserKeybindingsService.initialize();

configureEditorHost({
  setContextKey: (key, value) => ContextKeyService.set(key, value),
  updateWindowTitle: (activeEditor) =>
    WindowTitleService.updateFromEditor(activeEditor),
});
WindowTitleService.setWorkspaceName("silk-db-studio");
configureDbStudioAiContextHost();
configureDbStudioAiToolHost();
configureDbStudioAiSqlProposalHost();
configureDbStudioDiagnosticsHost();
AppLogService.installGlobalHandlers();
void AppLogService.info("Frontend bootstrap complete.", "bootstrap");
applyWorkbenchFonts();

// Suppress WebView2's native browser context menu (Back/Refresh/Save As/Print/Inspect…) — it
// has no place in a desktop app shell. Areas with their own context menu (Explorer, tab bar,
// activity bar, …) already call `event.preventDefault()` in their own handler, so this only
// affects the areas that had no menu at all.
document.addEventListener("contextmenu", (event) => event.preventDefault());

// Hold blank Untitled until Hot Exit restore finishes (see startEditorSessionSync).
EditorGroupsService.prepareSessionRestore();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
