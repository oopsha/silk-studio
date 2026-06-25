import { useEffect, useState } from "react";
import { EditorService } from "./editorService";

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
