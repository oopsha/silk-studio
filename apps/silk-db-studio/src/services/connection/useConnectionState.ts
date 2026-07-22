import { useEffect, useState } from "react";
import { ConnectionService } from "./connectionService";
import type { ConnectionState } from "./connectionTypes";

export function useConnectionState(): ConnectionState {
  const [state, setState] = useState(() => ConnectionService.getState());

  useEffect(() => {
    return ConnectionService.onDidChange(() => {
      setState(ConnectionService.getState());
    });
  }, []);

  return state;
}
