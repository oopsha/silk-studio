import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import DdlPreview from "../ddl/DdlPreview";
import ObjectEditorHeader from "./ObjectEditorHeader";
import ColumnsPreview from "./ColumnsPreview";
import IndexesPreview from "./IndexesPreview";
import ForeignKeysPreview from "./ForeignKeysPreview";
import ReferencesPreview from "./ReferencesPreview";
import ConstraintsPreview from "./ConstraintsPreview";
import TriggersPreview from "./TriggersPreview";
import DependenciesPreview from "./DependenciesPreview";
import "./PropertiesView.css";

type PropertiesRenderCtx = {
  objectRef: ObjectEditorRef;
  tabId: string;
  tabUri: string | undefined;
  bufferedContent: string | undefined;
};

type PropertiesSection = {
  id: string;
  labelKey: MessageKey;
  render: (ctx: PropertiesRenderCtx) => ReactNode;
};

const PROPERTIES_SECTIONS: PropertiesSection[] = [
  {
    id: "columns",
    labelKey: "app.objectEditor.columnsSection",
    render: (ctx) => <ColumnsPreview objectRef={ctx.objectRef} />,
  },
  {
    id: "indexes",
    labelKey: "app.objectEditor.indexesSection",
    render: (ctx) => <IndexesPreview objectRef={ctx.objectRef} />,
  },
  {
    id: "foreignKeys",
    labelKey: "app.objectEditor.foreignKeysSection",
    render: (ctx) => <ForeignKeysPreview objectRef={ctx.objectRef} />,
  },
  {
    id: "references",
    labelKey: "app.objectEditor.referencesSection",
    render: (ctx) => <ReferencesPreview objectRef={ctx.objectRef} />,
  },
  {
    id: "constraints",
    labelKey: "app.objectEditor.constraintsSection",
    render: (ctx) => <ConstraintsPreview objectRef={ctx.objectRef} />,
  },
  {
    id: "triggers",
    labelKey: "app.objectEditor.triggersSection",
    render: (ctx) => <TriggersPreview objectRef={ctx.objectRef} />,
  },
  {
    id: "dependencies",
    labelKey: "app.objectEditor.dependenciesSection",
    render: (ctx) => <DependenciesPreview objectRef={ctx.objectRef} />,
  },
  {
    id: "ddl",
    labelKey: "app.objectEditor.ddlSection",
    render: (ctx) => (
      <DdlPreview
        objectRef={ctx.objectRef}
        tabId={ctx.tabId}
        tabUri={ctx.tabUri}
        bufferedContent={ctx.bufferedContent}
      />
    ),
  },
];

type PropertiesViewProps = {
  objectRef: ObjectEditorRef;
  tabId: string;
  tabUri: string | undefined;
  bufferedContent: string | undefined;
};

/**
 * Which Properties section (DDL/columns/…) was last shown for a given tab.
 * Switching away to another editor tab and back unmounts/remounts this
 * component (see EditorArea's `renderAlternative`), so React state alone
 * doesn't survive — this keeps the choice per tab across that remount, same
 * pattern as ObjectEditorView's own 속성/데이터 tab memory.
 */
const activeSectionIdByTabId = new Map<string, string>();

function PropertiesView({ objectRef, tabId, tabUri, bufferedContent }: PropertiesViewProps) {
  const { t } = useI18n();
  const [activeSectionId, setActiveSectionIdState] = useState(
    () => activeSectionIdByTabId.get(tabId) ?? PROPERTIES_SECTIONS[0].id,
  );

  const setActiveSectionId = (id: string) => {
    setActiveSectionIdState(id);
    activeSectionIdByTabId.set(tabId, id);
  };

  // No remount when switching directly between two object-editor tabs (same
  // component instance, different `tabId`) — resync from the per-tab map.
  useEffect(() => {
    setActiveSectionIdState(activeSectionIdByTabId.get(tabId) ?? PROPERTIES_SECTIONS[0].id);
  }, [tabId]);

  const active =
    PROPERTIES_SECTIONS.find((section) => section.id === activeSectionId) ??
    PROPERTIES_SECTIONS[0];

  return (
    <div className="object-editor-properties-page">
      <ObjectEditorHeader objectRef={objectRef} />
      <div className="object-editor-properties">
        <aside className="object-editor-properties__sidebar">
          <nav className="object-editor-properties__nav">
            {PROPERTIES_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`object-editor-properties__nav-item${
                  section.id === activeSectionId
                    ? " object-editor-properties__nav-item--active"
                    : ""
                }`}
                onClick={() => setActiveSectionId(section.id)}
              >
                {t(section.labelKey)}
              </button>
            ))}
          </nav>
        </aside>
        <div className="object-editor-properties__content">
          {active.render({ objectRef, tabId, tabUri, bufferedContent })}
        </div>
      </div>
    </div>
  );
}

export default PropertiesView;
