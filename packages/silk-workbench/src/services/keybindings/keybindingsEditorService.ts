import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { KEYBINDINGS_EDITOR_URI } from "./keybindingsEditorConstants";

class KeybindingsEditorServiceImpl {
  openKeybindings(): void {
    EditorService.openEditor({
      uri: KEYBINDINGS_EDITOR_URI,
      label: "Keyboard Shortcuts",
      languageId: "plaintext",
      content: "",
      preview: false,
    });
    const tab = EditorService.getTabs().find(
      (item) => item.uri === KEYBINDINGS_EDITOR_URI,
    );
    if (tab) {
      EditorService.pinTab(tab.id);
    }
  }

  isKeybindingsTab(uri: string | undefined): boolean {
    return uri === KEYBINDINGS_EDITOR_URI;
  }
}

export const KeybindingsEditorService = new KeybindingsEditorServiceImpl();
