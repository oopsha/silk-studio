import { useEffect, useState } from "react";
import { LayoutService, type LayoutState } from "./layoutService";

export function useLayoutState(): LayoutState {
  const [state, setState] = useState(() => LayoutService.getState());

  useEffect(() => {
    return LayoutService.onDidChange(() => {
      setState(LayoutService.getState());
    });
  }, []);

  return state;
}
