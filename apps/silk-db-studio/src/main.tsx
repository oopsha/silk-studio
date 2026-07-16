import React from "react";
import ReactDOM from "react-dom/client";
import { applyWorkbenchFonts } from "./platform/fonts";
import "./global.css";
import "./workbench/workbench.contribution";
import App from "./App";

applyWorkbenchFonts();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
