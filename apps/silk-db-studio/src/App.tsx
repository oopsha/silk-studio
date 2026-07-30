import { useEffect } from "react";
import { AiSecretService } from "@silk-studio/workbench/services/ai/aiSecretService.ts";
import { startNativeMenubar } from "@silk-studio/workbench/services/nativeMenubar/nativeMenubarService.ts";
import AppShell from "./components/layout/AppShell";
import { ConnectionService } from "./services/connection/connectionService";
import { startWindowLayoutSync } from "./services/windowLayoutSync";

function App() {
  useEffect(() => {
    void ConnectionService.initialize();
    void AiSecretService.initialize();
    const stopMenubar = startNativeMenubar();
    const stopWindowLayout = startWindowLayoutSync();
    return () => {
      stopMenubar();
      stopWindowLayout();
    };
  }, []);

  return <AppShell />;
}

export default App;
