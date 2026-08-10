import { useEffect, useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { parseObjectEditorUri } from "../../services/connection/objectEditorConstants";
import PropertiesView from "./PropertiesView";
import DataView from "./DataView";
import "./ObjectEditorView.css";

type ObjectEditorSection = "properties" | "data";

/**
 * Which section (속성/데이터) was last shown for a given tab. Switching away to
 * another editor tab and back unmounts/remounts this component (see
 * EditorArea's `renderAlternative`), so React state alone doesn't survive —
 * this keeps the choice per tab across that remount.
 */
const activeSectionByTabId = new Map<string, ObjectEditorSection>();

function ObjectEditorView() {
  const { t } = useI18n();
  const activeTab = useActiveEditor();
  const ref = parseObjectEditorUri(activeTab?.uri);
  const [activeSection, setActiveSectionState] = useState<ObjectEditorSection>(
    () => (activeTab ? (activeSectionByTabId.get(activeTab.id) ?? "properties") : "properties"),
  );

  const setActiveSection = (section: ObjectEditorSection) => {
    setActiveSectionState(section);
    if (activeTab) {
      activeSectionByTabId.set(activeTab.id, section);
    }
  };

  // No remount when switching directly between two object-editor tabs (same
  // component instance, different `activeTab`) — resync from the per-tab map.
  useEffect(() => {
    if (!activeTab) return;
    setActiveSectionState(activeSectionByTabId.get(activeTab.id) ?? "properties");
  }, [activeTab?.id]);

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
        {activeSection === "properties" ? (
          <PropertiesView
            objectRef={ref}
            tabId={activeTab.id}
            tabUri={activeTab.uri}
            bufferedContent={activeTab.content}
          />
        ) : (
          <DataView objectRef={ref} />
        )}
      </div>
    </div>
  );
}

export default ObjectEditorView;
