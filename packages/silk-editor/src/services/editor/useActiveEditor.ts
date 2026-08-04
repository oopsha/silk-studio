import { useEffect, useState } from "react";
import { EditorService } from "./editorService";
import type { EditorTab } from "./editorTypes";

function snapshotActiveTab(): EditorTab | undefined {
  const tab = EditorService.getActiveTab();
  return tab ? { ...tab } : undefined;
}

export function useActiveEditor(): EditorTab | undefined {
  const [activeTab, setActiveTab] = useState(snapshotActiveTab);

  useEffect(() => {
    return EditorService.onDidChange(() => {
      setActiveTab(snapshotActiveTab());
    });
  }, []);

  return activeTab;
}
