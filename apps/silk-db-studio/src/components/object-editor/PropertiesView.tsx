import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { MetadataObjectKind } from "@silk-studio/db-protocol";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import type { ObjectEditorRef } from "../../services/connection/objectEditorConstants";
import { ConnectionService } from "../../services/connection/connectionService";
import { supportsPlsqlSourceEdit } from "../../services/connection/plsqlEditorService";
import { supportsTableStructureEdit } from "../../services/connection/explorerObjectMutationSql";
import DdlPreview from "../ddl/DdlPreview";
import ViewDdlEditor from "./ViewDdlEditor";
import ObjectEditorHeader from "./ObjectEditorHeader";
import ColumnsPreview from "./ColumnsPreview";
import TableStructureEditor from "./TableStructureEditor";
import { useTableStructureEditorState } from "./useTableStructureEditorState";
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
  /** Set only for tables on a driver that supports structure editing — see
   *  `useTableStructureEditorState`'s doc comment. */
  tableEditor: ReturnType<typeof useTableStructureEditorState>;
};

type PropertiesSection = {
  id: string;
  labelKey: MessageKey;
  render: (ctx: PropertiesRenderCtx) => ReactNode;
  /**
   * Kinds this section applies to; omit for "every kind". A VIEW has no physical storage, so
   * it can never carry a FOREIGN KEY, be the target of one (REFERENCES), or declare a
   * PRIMARY KEY/UNIQUE/CHECK constraint — those three sections would always render empty for
   * a view and are hidden for it. INDEXES is hidden too: an ordinary view can't have one either
   * (a Postgres materialized view technically can, but this app doesn't expose materialized
   * views as their own kind, so there's no way to special-case just those). TRIGGERS stays
   * visible — Oracle/SQL Server/PostgreSQL all support INSTEAD OF triggers on views.
   */
  kinds?: MetadataObjectKind[];
};

const PROPERTIES_SECTIONS: PropertiesSection[] = [
  {
    id: "columns",
    labelKey: "app.objectEditor.columnsSection",
    render: (ctx) =>
      ctx.tableEditor ? (
        <TableStructureEditor state={ctx.tableEditor} />
      ) : (
        <ColumnsPreview objectRef={ctx.objectRef} />
      ),
  },
  {
    id: "indexes",
    labelKey: "app.objectEditor.indexesSection",
    render: (ctx) => <IndexesPreview objectRef={ctx.objectRef} />,
    kinds: ["table"],
  },
  {
    id: "foreignKeys",
    labelKey: "app.objectEditor.foreignKeysSection",
    render: (ctx) => <ForeignKeysPreview objectRef={ctx.objectRef} />,
    kinds: ["table"],
  },
  {
    id: "references",
    labelKey: "app.objectEditor.referencesSection",
    render: (ctx) => <ReferencesPreview objectRef={ctx.objectRef} />,
    kinds: ["table"],
  },
  {
    id: "constraints",
    labelKey: "app.objectEditor.constraintsSection",
    render: (ctx) => <ConstraintsPreview objectRef={ctx.objectRef} />,
    kinds: ["table"],
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
    render: (ctx) => {
      const driverId = ConnectionService.getProfile(ctx.objectRef.profileId)?.driverId;
      const isEditableView =
        ctx.objectRef.kind === "view" &&
        driverId !== undefined &&
        supportsPlsqlSourceEdit(driverId, "view");
      if (isEditableView) {
        return (
          <ViewDdlEditor
            objectRef={ctx.objectRef}
            tabId={ctx.tabId}
            tabUri={ctx.tabUri}
            bufferedContent={ctx.bufferedContent}
          />
        );
      }
      return (
        <DdlPreview
          objectRef={ctx.objectRef}
          tabId={ctx.tabId}
          tabUri={ctx.tabUri}
          bufferedContent={ctx.bufferedContent}
        />
      );
    },
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
  const sections = PROPERTIES_SECTIONS.filter(
    (section) => !section.kinds || section.kinds.includes(objectRef.kind),
  );
  const [activeSectionId, setActiveSectionIdState] = useState(
    () => activeSectionIdByTabId.get(tabId) ?? sections[0].id,
  );

  const driverId = ConnectionService.getProfile(objectRef.profileId)?.driverId;
  const isTableStructureEditable =
    driverId !== undefined && supportsTableStructureEdit(driverId, objectRef.kind);
  const tableEditor = useTableStructureEditorState({
    objectRef,
    tabId,
    driverId,
    enabled: isTableStructureEditable,
  });

  const setActiveSectionId = (id: string) => {
    setActiveSectionIdState(id);
    activeSectionIdByTabId.set(tabId, id);
  };

  // No remount when switching directly between two object-editor tabs (same
  // component instance, different `tabId`) — resync from the per-tab map.
  useEffect(() => {
    setActiveSectionIdState(activeSectionIdByTabId.get(tabId) ?? sections[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sections` is derived from
    // objectRef.kind, which is fixed for a tab's lifetime; keying off `tabId` alone matches
    // the resync this effect is for (switching between two already-open object-editor tabs).
  }, [tabId]);

  const active =
    sections.find((section) => section.id === activeSectionId) ?? sections[0];

  return (
    <div className="object-editor-properties-page">
      <ObjectEditorHeader objectRef={objectRef} tableEditor={tableEditor} />
      <div className="object-editor-properties">
        <aside className="object-editor-properties__sidebar">
          <nav className="object-editor-properties__nav">
            {sections.map((section) => (
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
          {active.render({ objectRef, tabId, tabUri, bufferedContent, tableEditor })}
        </div>
      </div>
    </div>
  );
}

export default PropertiesView;
