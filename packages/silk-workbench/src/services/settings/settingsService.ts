import { EditorService } from "@silk-studio/editor/services/editor/editorService.ts";
import { I18nService } from "../../platform/i18n/i18nService";
import {
  SETTINGS_CATEGORY_ORDER,
  SETTINGS_EDITOR_URI,
  type SettingsCategory,
} from "./settingsConstants";

type SettingsOpenListener = (category: SettingsCategory) => void;

class SettingsServiceImpl {
  private activeCategory: SettingsCategory = "appearance";
  private readonly listeners = new Set<SettingsOpenListener>();
  private localeUnsub: (() => void) | null = null;

  start(): void {
    if (this.localeUnsub) return;
    I18nService.start();
    this.localeUnsub = I18nService.onDidChangeLocale(() => {
      this.syncTabLabel();
    });
  }

  getActiveCategory(): SettingsCategory {
    return this.activeCategory;
  }

  openSettings(category: SettingsCategory = "appearance"): void {
    this.start();
    this.activeCategory = category;
    this.fireDidOpen(category);

    EditorService.openEditor({
      uri: SETTINGS_EDITOR_URI,
      label: I18nService.t("settings.title"),
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

  private syncTabLabel(): void {
    const tab = EditorService.getTabs().find(
      (item) => item.uri === SETTINGS_EDITOR_URI,
    );
    if (!tab) return;
    const label = I18nService.t("settings.title");
    if (tab.label === label) return;
    EditorService.markTabSaved(tab.id, undefined, label);
  }

  private fireDidOpen(category: SettingsCategory): void {
    for (const listener of this.listeners) {
      listener(category);
    }
  }
}

export const SettingsService = new SettingsServiceImpl();
