import { useEffect } from "react";
import AppShell from "./components/layout/AppShell";
import { ConnectionService } from "./services/connection/connectionService";

function App() {
  useEffect(() => {
    void ConnectionService.initialize();
  }, []);

  return <AppShell />;
}

export default App;
