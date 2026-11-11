import { useEffect, useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { useEditorTabs } from "@silk-studio/editor/services/editor/useEditorTabs.ts";
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
  /** The tab this kept-alive view belongs to, independent of the group's active tab. */
  tabId: string;
};

function ObjectEditorView({ groupId, tabId }: ObjectEditorViewProps) {
  const { t } = useI18n();
  const tabs = useEditorTabs(groupId);
  const activeTab = useActiveEditor(groupId);
  const tab = tabs.find((item) => item.id === tabId);
  const ref = parseObjectEditorUri(tab?.uri);
  const [activeSection, setActiveSectionState] = useState<ObjectEditorSection>(
    () => getObjectEditorSection(tabId) ?? "properties",
  );
  const [dataOpenedTabId, setDataOpenedTabId] = useState<string | null>(() =>
    getObjectEditorSection(tabId) === "data" ? tabId : null,
  );

  const setActiveSection = (section: ObjectEditorSection) => {
    setActiveSectionState(section);
    if (section === "data") setDataOpenedTabId(tabId);
    setObjectEditorSection(tabId, section);
  };

  // Each kept-alive editor page has a fixed tab id; restore its section if the page is remounted.
  useEffect(() => {
    const section = getObjectEditorSection(tabId) ?? "properties";
    setActiveSectionState(section);
    setDataOpenedTabId(section === "data" ? tabId : null);
  }, [tabId]);

  useEffect(() => onDidChangeObjectEditorSection((changedTabId, section) => {
    if (changedTabId !== tabId) return;
    setActiveSectionState(section);
    if (section === "data") setDataOpenedTabId(changedTabId);
  }), [tabId]);

  if (!ref || !tab) {
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
          hidden={activeSection !== "properties"}
        >
          <PropertiesView
            key={tab.id}
            groupId={groupId}
            objectRef={ref}
            tabId={tab.id}
            tabUri={tab.uri}
            bufferedContent={tab.content}
          />
        </div>
        {dataOpenedTabId === tab.id ? (
          <div
            className={`object-editor-view__section${activeSection === "data" ? " object-editor-view__section--active" : ""}`}
            aria-hidden={activeSection !== "data"}
            hidden={activeSection !== "data"}
          >
            <DataView objectRef={ref} ownerId={tabId} groupId={groupId}
              commandEligible={activeTab?.id === tabId && activeSection === "data"} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ObjectEditorView;
