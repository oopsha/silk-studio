import { useEffect, useState } from "react";
import { EditorStatusService } from "./editorStatusService";

export function useEditorCursorPosition() {
  const [cursorPosition, setCursorPosition] = useState(() =>
    EditorStatusService.getCursorPosition(),
  );

  useEffect(() => {
    return EditorStatusService.onDidChange(() => {
      setCursorPosition(EditorStatusService.getCursorPosition());
    });
  }, []);

  return cursorPosition;
}
