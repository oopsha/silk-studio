import { useEffect, useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import type { EditorGroupId } from "@silk-studio/editor/services/editor/editorGroupTypes.ts";
import { parseObjectEditorUri } from "../../services/connection/objectEditorConstants";
import PropertiesView from "./PropertiesView";
import DataView from "./DataView";
import { getObjectEditorSection, onDidChangeObjectEditorSection, setObjectEditorSection, type ObjectEditorSection } from "../../services/connection/objectEditorSectionService";
import "./ObjectEditorView.css";

type ObjectEditorViewProps = {
  /** The pane this view belongs to; it may be visible without being focused. */
  groupId: EditorGroupId;
};

function ObjectEditorView({ groupId }: ObjectEditorViewProps) {
  const { t } = useI18n();
  const activeTab = useActiveEditor(groupId);
  const ref = parseObjectEditorUri(activeTab?.uri);
  const [activeSection, setActiveSectionState] = useState<ObjectEditorSection>(
    () => (activeTab ? (getObjectEditorSection(activeTab.id) ?? "properties") : "properties"),
  );
  const [dataOpenedTabId, setDataOpenedTabId] = useState<string | null>(() =>
    activeTab && getObjectEditorSection(activeTab.id) === "data" ? activeTab.id : null,
  );

  const setActiveSection = (section: ObjectEditorSection) => {
    setActiveSectionState(section);
    if (activeTab) {
      if (section === "data") setDataOpenedTabId(activeTab.id);
      setObjectEditorSection(activeTab.id, section);
    }
  };

  // No remount when switching directly between two object-editor tabs (same
  // component instance, different `activeTab`) — resync from the per-tab map.
  useEffect(() => {
    if (!activeTab) return;
    const section = getObjectEditorSection(activeTab.id) ?? "properties";
    setActiveSectionState(section);
    setDataOpenedTabId(section === "data" ? activeTab.id : null);
  }, [activeTab?.id]);

  useEffect(() => onDidChangeObjectEditorSection((tabId, section) => {
    if (tabId !== activeTab?.id) return;
    setActiveSectionState(section);
    if (section === "data") setDataOpenedTabId(tabId);
  }), [activeTab?.id]);

  if (!ref || !activeTab) {
    return (
      <div className="object-editor-view__error">
        {t("app.objectEditor.invalidTab")}
      </div>
    );
  }

  return (
    <div className="object-editor-view">
      <div className="object-editor-view__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "properties"}
          className={`object-editor-view__tab${activeSection === "properties" ? " object-editor-view__tab--active" : ""}`}
          onClick={() => setActiveSection("properties")}
        >
          {t("app.objectEditor.propertiesTab")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "data"}
          className={`object-editor-view__tab${activeSection === "data" ? " object-editor-view__tab--active" : ""}`}
          onClick={() => setActiveSection("data")}
        >
          {t("app.objectEditor.dataTab")}
        </button>
      </div>
      <div className="object-editor-view__body">
        <div
          className={`object-editor-view__section${activeSection === "properties" ? " object-editor-view__section--active" : ""}`}
          aria-hidden={activeSection !== "properties"}
        >
          <PropertiesView
            key={activeTab.id}
            objectRef={ref}
            tabId={activeTab.id}
            tabUri={activeTab.uri}
            bufferedContent={activeTab.content}
          />
        </div>
        {dataOpenedTabId === activeTab.id ? (
          <div
            className={`object-editor-view__section${activeSection === "data" ? " object-editor-view__section--active" : ""}`}
            aria-hidden={activeSection !== "data"}
          >
            <DataView objectRef={ref} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ObjectEditorView;
