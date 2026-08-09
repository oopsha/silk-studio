import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { parseDdlEditorUri } from "../../services/connection/ddlEditorConstants";
import DdlPreview from "./DdlPreview";
import "./DdlEditorView.css";

function DdlEditorView() {
  const { t } = useI18n();
  const activeTab = useActiveEditor();
  const ref = parseDdlEditorUri(activeTab?.uri);

  return (
    <div className="ddl-editor-view">
      <div className="ddl-editor-view__banner" role="status">
        {t("app.ddl.banner")}
        {ref ? ` · ${ref.schemaName}.${ref.objectName}` : ""}
      </div>
      <DdlPreview
        objectRef={ref}
        tabId={activeTab?.id}
        tabUri={activeTab?.uri}
        bufferedContent={activeTab?.content}
      />
    </div>
  );
}

export default DdlEditorView;
