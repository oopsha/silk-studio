import type { ReactNode } from "react";
import { useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import DdlPreview from "../ddl/DdlPreview";
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

// Future sections (columns, indexes, constraints) can be appended here once
// the backend exposes that metadata — nothing else needs to change.
const PROPERTIES_SECTIONS: PropertiesSection[] = [
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

function PropertiesView({ objectRef, tabId, tabUri, bufferedContent }: PropertiesViewProps) {
  const { t } = useI18n();
  const [activeSectionId, setActiveSectionId] = useState(PROPERTIES_SECTIONS[0].id);
  const active =
    PROPERTIES_SECTIONS.find((section) => section.id === activeSectionId) ??
    PROPERTIES_SECTIONS[0];

  return (
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
  );
}

export default PropertiesView;
