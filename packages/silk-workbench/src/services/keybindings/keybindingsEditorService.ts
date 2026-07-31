import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { I18nService } from "../../platform/i18n/i18nService";
import { KEYBINDINGS_EDITOR_URI } from "./keybindingsEditorConstants";

class KeybindingsEditorServiceImpl {
  private localeUnsub: (() => void) | null = null;

  start(): void {
    if (this.localeUnsub) return;
    I18nService.start();
    this.localeUnsub = I18nService.onDidChangeLocale(() => {
      this.syncTabLabel();
    });
  }

  openKeybindings(): void {
    this.start();
    EditorService.openEditor({
      uri: KEYBINDINGS_EDITOR_URI,
      label: I18nService.t("workbench.commands.keyboardShortcuts"),
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

  private syncTabLabel(): void {
    const tab = EditorService.getTabs().find(
      (item) => item.uri === KEYBINDINGS_EDITOR_URI,
    );
    if (!tab) return;
    const label = I18nService.t("workbench.commands.keyboardShortcuts");
    if (tab.label === label) return;
    EditorService.markTabSaved(tab.id, undefined, label);
  }
}

export const KeybindingsEditorService = new KeybindingsEditorServiceImpl();
