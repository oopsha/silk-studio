import { useEffect, useState } from "react";
import {
  QueryExecutionService,
  type QueryExecutionState,
} from "./queryExecutionService";

export function useQueryExecutionState(): QueryExecutionState {
  const [state, setState] = useState(() => QueryExecutionService.getState());

  useEffect(() => {
    return QueryExecutionService.onDidChange(() => {
      setState(QueryExecutionService.getState());
    });
  }, []);

  return state;
}
