import { useEffect, useState } from "react";
import { SearchConnectionSelectionService } from "./searchConnectionSelectionService";

/** `null` = every connection profile is searched (the default). */
export function useSearchConnectionSelection(): Set<string> | null {
  const [selection, setSelection] = useState(() =>
    SearchConnectionSelectionService.getSelection(),
  );

  useEffect(() => {
    return SearchConnectionSelectionService.onDidChange(() => {
      setSelection(SearchConnectionSelectionService.getSelection());
    });
  }, []);

  return selection;
}
