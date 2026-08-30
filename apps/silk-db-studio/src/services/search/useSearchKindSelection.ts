import { useEffect, useState } from "react";
import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import { SearchKindSelectionService } from "./searchKindSelectionService";

export function useSearchKindSelection(): Set<MetadataObjectKind> {
  const [selection, setSelection] = useState(() =>
    SearchKindSelectionService.getSelection(),
  );

  useEffect(() => {
    return SearchKindSelectionService.onDidChange(() => {
      setSelection(SearchKindSelectionService.getSelection());
    });
  }, []);

  return selection;
}
