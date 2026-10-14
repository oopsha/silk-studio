import React from "react";
import ReactDOM from "react-dom/client";
import { applyWorkbenchFonts } from "@silk-studio/ui/platform/fonts.ts";
import { configureEditorHost } from "@silk-studio/editor/services/editor/editorHost.ts";
import { EditorGroupsService } from "@silk-studio/editor/services/editor/editorGroupsService.ts";
import { ContextKeyService } from "@silk-studio/workbench/platform/context/contextKeyService.ts";
import { UserKeybindingsService } from "@silk-studio/workbench/platform/keybinding/userKeybindingsService.ts";
import { WindowTitleService } from "@silk-studio/workbench/services/windowTitle/windowTitleService.ts";
import { ConfirmDialogService } from "@silk-studio/workbench/services/dialog/confirmDialogService.ts";
import { AppLogService } from "@silk-studio/workbench/services/diagnostics/appLogService.ts";
import "@silk-studio/workbench/components/layout/WorkbenchShell/WorkbenchShell.css";
import "@silk-studio/workbench/workbench/workbench.contribution";
import "./workbench/contributions/fileActions.contribution";
import "@silk-studio/ui/global.css";
import "./app.css";
import App from "./App";

UserKeybindingsService.initialize();
configureEditorHost({
  setContextKey: (key, value) => ContextKeyService.set(key, value),
  updateWindowTitle: (activeEditor) =>
    WindowTitleService.updateFromEditor(activeEditor),
  confirmCloseDirtyTab: (tab) =>
    ConfirmDialogService.confirm({
      title: "변경 사항 닫기",
      message: `저장하지 않은 변경 사항이 있습니다: ${tab.label}\n닫을까요?`,
      confirmLabel: "닫기",
      cancelLabel: "취소",
      danger: true,
    }),
});
WindowTitleService.setWorkspaceName("silk-be-studio");
EditorGroupsService.prepareSessionRestore();
applyWorkbenchFonts();
AppLogService.installGlobalHandlers();
void AppLogService.info("Frontend bootstrap complete.", "bootstrap");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
