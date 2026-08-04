import { useEffect, useState } from "react";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { EditorConnectionBindingService } from "./editorConnectionBindingService";
import type { EditorConnectionBinding } from "./editorConnectionBindingService";
import { useConnectionState } from "./useConnectionState";

export function useEditorConnectionBinding(): EditorConnectionBinding {
  const activeTab = useActiveEditor();
  const connection = useConnectionState();
  const [binding, setBinding] = useState(() =>
    EditorConnectionBindingService.getActiveBinding(),
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return EditorConnectionBindingService.onDidChange(() => {
      setTick((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    setBinding(EditorConnectionBindingService.getActiveBinding());
  }, [activeTab?.id, connection.connectedProfileIds, connection.status, tick]);

  return binding;
}
