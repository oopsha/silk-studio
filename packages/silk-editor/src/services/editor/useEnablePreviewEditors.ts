import { useEffect, useState } from "react";
import { EditorService } from "./editorServiceFacade";

export function useEnablePreviewEditors(): boolean {
  const [enabled, setEnabled] = useState(() =>
    EditorService.getEnablePreviewEditors(),
  );

  useEffect(() => {
    return EditorService.onDidChange(() => {
      setEnabled(EditorService.getEnablePreviewEditors());
    });
  }, []);

  return enabled;
}
