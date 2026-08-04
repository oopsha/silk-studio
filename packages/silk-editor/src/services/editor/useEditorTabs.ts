import { useEffect, useState } from "react";
import { EditorService } from "./editorService";
import type { EditorTab } from "./editorTypes";

function snapshotTabs(): EditorTab[] {
  return EditorService.getTabs().map((tab) => ({ ...tab }));
}

export function useEditorTabs(): readonly EditorTab[] {
  const [tabs, setTabs] = useState(snapshotTabs);

  useEffect(() => {
    return EditorService.onDidChange(() => {
      setTabs(snapshotTabs());
    });
  }, []);

  return tabs;
}
