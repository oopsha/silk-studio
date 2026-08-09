import { useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { parseObjectEditorUri } from "../../services/connection/objectEditorConstants";
import PropertiesView from "./PropertiesView";
import DataView from "./DataView";
import "./ObjectEditorView.css";

type ObjectEditorSection = "properties" | "data";

function ObjectEditorView() {
  const { t } = useI18n();
  const activeTab = useActiveEditor();
  const ref = parseObjectEditorUri(activeTab?.uri);
  const [activeSection, setActiveSection] = useState<ObjectEditorSection>("properties");

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
