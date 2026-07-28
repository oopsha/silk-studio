import { useEffect } from "react";
import { startNativeMenubar } from "@silk-studio/workbench/services/nativeMenubar/nativeMenubarService.ts";
import AppShell from "./components/layout/AppShell";
import { ConnectionService } from "./services/connection/connectionService";

function App() {
  useEffect(() => {
    void ConnectionService.initialize();
    return startNativeMenubar();
  }, []);

  return <AppShell />;
}

export default App;
