import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import {
  SETTINGS_CATEGORY_ORDER,
  SETTINGS_EDITOR_URI,
  type SettingsCategory,
} from "./settingsConstants";

type SettingsOpenListener = (category: SettingsCategory) => void;

class SettingsServiceImpl {
  private activeCategory: SettingsCategory = "appearance";
  private readonly listeners = new Set<SettingsOpenListener>();

  getActiveCategory(): SettingsCategory {
    return this.activeCategory;
  }

  openSettings(category: SettingsCategory = "appearance"): void {
    this.activeCategory = category;
    this.fireDidOpen(category);

    EditorService.openEditor({
      uri: SETTINGS_EDITOR_URI,
      label: "Settings",
      languageId: "plaintext",
      content: "",
      preview: false,
    });
    const settingsTab = EditorService.getTabs().find(
      (tab) => tab.uri === SETTINGS_EDITOR_URI,
    );
    if (settingsTab) {
      EditorService.pinTab(settingsTab.id);
    }
  }

  setActiveCategory(category: SettingsCategory): void {
    if (this.activeCategory === category) return;
    this.activeCategory = category;
    this.fireDidOpen(category);
  }

  onDidOpen(listener: SettingsOpenListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isSettingsTab(uri: string | undefined): boolean {
    return uri === SETTINGS_EDITOR_URI;
  }

  getCategories(): SettingsCategory[] {
    return SETTINGS_CATEGORY_ORDER;
  }

  private fireDidOpen(category: SettingsCategory): void {
    for (const listener of this.listeners) {
      listener(category);
    }
  }
}

export const SettingsService = new SettingsServiceImpl();
