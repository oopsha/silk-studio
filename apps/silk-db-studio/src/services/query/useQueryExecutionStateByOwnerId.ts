import { useEffect, useState } from "react";
import {
  QueryExecutionService,
  type QueryExecutionState,
} from "./queryExecutionService";

export function useQueryExecutionStateByOwnerId(ownerId: string): QueryExecutionState {
  const [state, setState] = useState(() => QueryExecutionService.getSessionState(ownerId));

  useEffect(() => {
    setState(QueryExecutionService.getSessionState(ownerId));
    return QueryExecutionService.onDidChange(() => {
      setState(QueryExecutionService.getSessionState(ownerId));
    });
  }, [ownerId]);

  return state;
}
