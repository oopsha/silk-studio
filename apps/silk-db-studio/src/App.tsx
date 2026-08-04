import { useEffect } from "react";
import { AiSecretService } from "@silk-studio/workbench/services/ai/aiSecretService.ts";
import { startNativeMenubar } from "@silk-studio/workbench/services/nativeMenubar/nativeMenubarService.ts";
import AppShell from "./components/layout/AppShell";
import { ConnectionService } from "./services/connection/connectionService";
import { startFileDropListener } from "./services/dnd/startFileDropListener";
import { startWindowLayoutSync } from "./services/windowLayoutSync";

function App() {
  useEffect(() => {
    void ConnectionService.initialize();
    void AiSecretService.initialize();
    const stopMenubar = startNativeMenubar();
    const stopWindowLayout = startWindowLayoutSync();
    const stopFileDrop = startFileDropListener();
    return () => {
      stopMenubar();
      stopWindowLayout();
      stopFileDrop();
    };
  }, []);

  return <AppShell />;
}

export default App;
