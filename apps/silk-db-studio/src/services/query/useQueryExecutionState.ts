import { useEffect, useState } from "react";
import type { EditorGroupId } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import {
  QueryExecutionService,
  type QueryExecutionState,
} from "./queryExecutionService";

export function useQueryExecutionState(groupId: EditorGroupId): QueryExecutionState {
  const [state, setState] = useState(() => QueryExecutionService.getState(groupId));

  useEffect(() => {
    setState(QueryExecutionService.getState(groupId));
    return QueryExecutionService.onDidChange(() => {
      setState(QueryExecutionService.getState(groupId));
    });
  }, [groupId]);

  return state;
}
