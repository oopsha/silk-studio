import { useEffect, useState } from "react";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { parseDdlEditorUri } from "../../services/connection/ddlEditorConstants";
import { ConnectionService } from "../../services/connection/connectionService";
import { supportsPlsqlSourceEdit } from "../../services/connection/plsqlEditorService";
import ArgumentsPreview from "../object-editor/ArgumentsPreview";
import DependenciesPreview from "../object-editor/DependenciesPreview";
import ViewDdlEditor from "../object-editor/ViewDdlEditor";
import DdlPreview from "./DdlPreview";
import PackageDdlEditorView from "./PackageDdlEditorView";
import "../object-editor/PropertiesView.css";
import "./DdlEditorView.css";

type SectionId = "dependencies" | "arguments" | "declaration";

const ROUTINE_SECTIONS: { id: SectionId; labelKey: MessageKey }[] = [
  { id: "declaration", labelKey: "app.objectEditor.declarationSection" },
  { id: "arguments", labelKey: "app.objectEditor.argumentsSection" },
  { id: "dependencies", labelKey: "app.objectEditor.dependenciesSection" },
];

/** Per-tab section memory, same rationale as PropertiesView's own map: switching to another
 * editor tab and back unmounts/remounts this component (EditorArea's `renderAlternative`). */
const activeSectionIdByTabId = new Map<string, SectionId>();

function DdlEditorView() {
  const { t } = useI18n();
  const activeTab = useActiveEditor();
  const ref = parseDdlEditorUri(activeTab?.uri);
  const tabId = activeTab?.id;

  // Standalone procedures/functions get a side-tab shell (Dependencies/Arguments/Declaration,
  // matching DBeaver) — this is now also the single entry point that used to be split between
  // "편집" (its own silk://plsql/... tab) and "DDL 보기" (this tab, read-only). Declaration
  // renders the same editable editor "편집" used to open — see ViewDdlEditor's doc comment and
  // resolvePlsqlSourceRef, which now also resolves this tab's URI — when the driver supports
  // PL/SQL source editing for this kind (currently Oracle only for procedure/function); every
  // other driver still sees a plain read-only DDL preview there. Packages get their own shell
  // (Dependencies/Spec/Body/Procedure/Function) in PackageDdlEditorView — see below — since
  // spec/body need two independently-dirty buffers that don't fit ViewDdlEditor's single-tab
  // model; everything else keeps the plain single-pane DDL view below.
  const isRoutine = ref?.kind === "procedure" || ref?.kind === "function";
  const driverId = ref ? ConnectionService.getProfile(ref.profileId)?.driverId : undefined;
  const isEditableDeclaration =
    isRoutine && driverId !== undefined && supportsPlsqlSourceEdit(driverId, ref!.kind);
  const isEditablePackage =
    ref?.kind === "package" && driverId !== undefined && supportsPlsqlSourceEdit(driverId, "package");

  const [activeSectionId, setActiveSectionIdState] = useState<SectionId>(
    () => (tabId && activeSectionIdByTabId.get(tabId)) || "declaration",
  );

  useEffect(() => {
    if (!tabId) return;
    setActiveSectionIdState(activeSectionIdByTabId.get(tabId) ?? "declaration");
  }, [tabId]);

  const setActiveSectionId = (id: SectionId) => {
    setActiveSectionIdState(id);
    if (tabId) {
      activeSectionIdByTabId.set(tabId, id);
    }
  };

  if (isEditablePackage && ref && tabId) {
    return <PackageDdlEditorView objectRef={ref} tabId={tabId} />;
  }

  if (!isRoutine || !ref) {
    return (
      <div className="ddl-editor-view">
        <div className="ddl-editor-view__banner" role="status">
          {t("app.ddl.banner")}
          {ref ? ` · ${ref.schemaName}.${ref.objectName}` : ""}
        </div>
        <DdlPreview
          objectRef={ref}
          tabId={tabId}
          tabUri={activeTab?.uri}
          bufferedContent={activeTab?.content}
        />
      </div>
    );
  }

  // ViewDdlEditor renders its own contextual banner + Save/Compile/Snapshot actions — showing
  // the generic (and, here, actively wrong) "read-only" banner above it would both duplicate
  // and contradict it.
  const showGenericBanner = !(activeSectionId === "declaration" && isEditableDeclaration);

  return (
    <div className="ddl-editor-view">
      {showGenericBanner ? (
        <div className="ddl-editor-view__banner" role="status">
          {t("app.ddl.banner")}
          {` · ${ref.schemaName}.${ref.objectName}`}
        </div>
      ) : null}
      <div className="object-editor-properties-page">
        <div className="object-editor-properties">
          <aside className="object-editor-properties__sidebar">
            <nav className="object-editor-properties__nav">
              {ROUTINE_SECTIONS.map((section) => (
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
            {activeSectionId === "dependencies" ? (
              <DependenciesPreview objectRef={ref} />
            ) : activeSectionId === "arguments" ? (
              <ArgumentsPreview objectRef={ref} />
            ) : isEditableDeclaration && tabId ? (
              <ViewDdlEditor
                objectRef={ref}
                tabId={tabId}
                tabUri={activeTab?.uri}
                bufferedContent={activeTab?.content}
              />
            ) : (
              <DdlPreview
                objectRef={ref}
                tabId={tabId}
                tabUri={activeTab?.uri}
                bufferedContent={activeTab?.content}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DdlEditorView;
