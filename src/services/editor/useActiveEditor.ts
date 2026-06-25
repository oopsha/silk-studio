import { useEffect, useState } from "react";
import { EditorService } from "./editorService";
import type { EditorTab } from "./editorTypes";

export function useActiveEditor(): EditorTab | undefined {
  const [activeTab, setActiveTab] = useState(() => EditorService.getActiveTab());

  useEffect(() => {
    return EditorService.onDidChange(() => {
      setActiveTab(EditorService.getActiveTab());
    });
  }, []);

  return activeTab;
}
