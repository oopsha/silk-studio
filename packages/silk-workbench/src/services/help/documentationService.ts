import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { DOCUMENTATION_EDITOR_URI } from "../keybindings/keybindingsEditorConstants";

class DocumentationServiceImpl {
  openDocumentation(): void {
    EditorService.openEditor({
      uri: DOCUMENTATION_EDITOR_URI,
      label: "Documentation",
      languageId: "plaintext",
      content: "",
      preview: false,
    });
    const tab = EditorService.getTabs().find(
      (item) => item.uri === DOCUMENTATION_EDITOR_URI,
    );
    if (tab) {
      EditorService.pinTab(tab.id);
    }
  }

  isDocumentationTab(uri: string | undefined): boolean {
    return uri === DOCUMENTATION_EDITOR_URI;
  }
}

export const DocumentationService = new DocumentationServiceImpl();
