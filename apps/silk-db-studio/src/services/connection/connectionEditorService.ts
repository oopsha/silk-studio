import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import {
  CONNECTION_EDITOR_URI_PREFIX,
  connectionEditorUri,
  parseConnectionEditorUri,
} from "./connectionEditorConstants";
import { ConnectionService } from "./connectionService";

class ConnectionEditorServiceImpl {
  openNewConnection(): void {
    this.openEditor("new", "New Connection");
  }

  openConnection(profileId: string): void {
    const profile = ConnectionService.getProfile(profileId);
    this.openEditor(profileId, profile?.name ?? "Connection");
  }

  isConnectionEditorTab(uri: string | undefined): boolean {
    return parseConnectionEditorUri(uri) !== null;
  }

  getProfileIdFromUri(uri: string | undefined): string | "new" | null {
    return parseConnectionEditorUri(uri);
  }

  private openEditor(profileId: string | "new", label: string): void {
    const uri = connectionEditorUri(profileId);
    EditorService.openEditor({
      uri,
      label,
      languageId: "plaintext",
      content: "",
      preview: false,
    });
    const tab = EditorService.getTabs().find((item) => item.uri === uri);
    if (tab) {
      EditorService.pinTab(tab.id);
    }
  }
}

export const ConnectionEditorService = new ConnectionEditorServiceImpl();

export { CONNECTION_EDITOR_URI_PREFIX };
