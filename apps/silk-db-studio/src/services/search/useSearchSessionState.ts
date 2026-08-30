import { useEffect, useState } from "react";
import { SearchSessionStateService, type SearchSessionState } from "./searchSessionStateService";

export function useSearchSessionState(): SearchSessionState {
  const [state, setState] = useState(() => SearchSessionStateService.getState());

  useEffect(() => {
    return SearchSessionStateService.onDidChange(() => {
      setState(SearchSessionStateService.getState());
    });
  }, []);

  return state;
}
