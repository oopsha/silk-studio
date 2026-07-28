import React from "react";
import ReactDOM from "react-dom/client";
import { applyWorkbenchFonts } from "@silk-studio/ui/platform/fonts.ts";
import { configureEditorHost } from "@silk-studio/editor/services/editor/editorHost.ts";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import { WindowTitleService } from "@silk-studio/workbench/services/windowTitle/windowTitleService.ts";
import "@silk-studio/ui/global.css";
import "@silk-studio/workbench/workbench/workbench.contribution";
import "./workbench/contributions/queryActions.contribution";
import "./workbench/contributions/queryResultActions.contribution";
import "./workbench/contributions/sqlLanguage.contribution";
import "./workbench/contributions/sqlFormat.contribution";
import "./workbench/contributions/queryHistory.contribution";
import App from "./App";

configureEditorHost({
  setContextKey: (key, value) => ContextKeyService.set(key, value),
  updateWindowTitle: (activeEditor) =>
    WindowTitleService.updateFromEditor(activeEditor),
});
applyWorkbenchFonts();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
