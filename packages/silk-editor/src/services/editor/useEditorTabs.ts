import { useEffect, useState } from "react";
import { EditorService } from "./editorService";
import type { EditorTab } from "./editorTypes";

export function useEditorTabs(): readonly EditorTab[] {
  const [tabs, setTabs] = useState(() => EditorService.getTabs());

  useEffect(() => {
    return EditorService.onDidChange(() => {
      setTabs(EditorService.getTabs());
    });
  }, []);

  return tabs;
}
