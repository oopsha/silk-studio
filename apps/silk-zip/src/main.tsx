import React from "react";
import ReactDOM from "react-dom/client";
import "@vscode/codicons/dist/codicon.css";
import "@silk-studio/ui/global.css";
import "./style.css";
import App from "./App";
import { WindowTitleService } from "@silk-studio/workbench/services/windowTitle/windowTitleService.ts";

WindowTitleService.setWorkspaceName("Silk Zip");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
