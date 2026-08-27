import { useCallback, useEffect, useRef, useState } from "react";
import { Editor } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { getEditorFontFamily } from "@silk-studio/ui/platform/fontDefaults.ts";
import { useConfiguration } from "@silk-studio/workbench/platform/configuration/useConfiguration.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import type { MessageKey } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { AppNotificationService } from "@silk-studio/workbench/services/notifications/appNotificationService.ts";
import {
  defineWorkbenchMonacoThemes,
  monacoThemeForColorTheme,
} from "@silk-studio/editor/themes/dark2026-monaco.ts";
import type { DdlEditorRef } from "../../services/connection/ddlEditorConstants";
import { bridgeFetchObjectDdl } from "../../services/connection/connectionDdlBridge";
import { bridgeCompileObject } from "../../services/connection/connectionCompileBridge";
import { buildPlsqlSaveSql } from "../../services/connection/plsqlSaveSql";
import { buildPlsqlTabLabel, type PlsqlEditorRef } from "../../services/connection/plsqlEditorConstants";
import { ConnectionService } from "../../services/connection/connectionService";
import { ConnectionTreeService } from "../../services/connection/connectionTreeService";
import { QueryExecutionService } from "../../services/query/queryExecutionService";
import { assertReadOnlyQueryAllowed } from "../../services/query/sqlGuard";
import { invalidateObjectPreviewCache } from "../../services/connection/objectPreviewCache";
import { formatErrorMessage } from "../../services/formatErrorMessage";
import { registerMonacoInstance } from "../../services/editor/monacoInstanceRegistry";
import { registerSqlLanguages } from "../../services/sql/registerSqlLanguages";
import { ConfirmDialogService } from "../../services/ui/confirmDialogService";
import { PackagePlsqlSaveDialogService } from "../../services/connection/packagePlsqlSaveDialogService";
import { PackagePlsqlHistoryDialogService } from "../../services/connection/packagePlsqlHistoryDialogService";
import { recordPlsqlSnapshot } from "../../services/connection/plsqlSnapshotService";
import DependenciesPreview from "../object-editor/DependenciesPreview";
import PackageMembersPreview from "../object-editor/PackageMembersPreview";
import "../object-editor/PropertiesView.css";
import "../object-editor/ViewDdlEditor.css";
import "./DdlEditorView.css";

type SectionId = "dependencies" | "spec" | "body" | "procedures" | "functions";

const PACKAGE_SECTIONS: { id: SectionId; labelKey: MessageKey }[] = [
  { id: "spec", labelKey: "app.objectEditor.specSection" },
  { id: "body", labelKey: "app.objectEditor.bodySection" },
  // Procedures before Functions matches METADATA_GROUP_ORDER (metadataGroups.ts) — the same
  // order the Explorer tree shows those group folders in.
  { id: "procedures", labelKey: "app.objectEditor.proceduresSection" },
  { id: "functions", labelKey: "app.objectEditor.functionsSection" },
  { id: "dependencies", labelKey: "app.objectEditor.dependenciesSection" },
];

type SourceBuffer = {
  loaded: string | null;
  current: string;
  loading: boolean;
  error: string | null;
};

const EMPTY_BUFFER: SourceBuffer = { loaded: null, current: "", loading: true, error: null };

type CompileErrorItem = { line: number; column: number; message: string };

type PackageDdlEditorViewProps = {
  objectRef: DdlEditorRef;
  tabId: string;
};

/** Per-tab section memory, same rationale as DdlEditorView's own map. */
const activeSectionIdByTabId = new Map<string, SectionId>();

/**
 * Package object editor — Dependencies/Spec/Body/Procedure/Function side-tab shell. Unlike
 * `ViewDdlEditor` (used for standalone procedures/functions/views), Spec and Body are edited as
 * two *independent* in-memory buffers rather than through `EditorService`'s tab-content system:
 * `EditorService.openEditor` always adds a visible tab-strip entry, so there's no way to give
 * spec and body their own tracked buffers while keeping them nested inside this one visible tab.
 * Save pushes whichever buffer(s) changed (`CREATE OR REPLACE PACKAGE [BODY]`, reusing
 * `buildPlsqlSaveSql` — already package-aware) and then always recompiles both spec and body,
 * matching DBeaver's `OraclePackage.getCompileActions()` (a package's saved state always issues
 * both `ALTER PACKAGE ... COMPILE` and `... COMPILE BODY`, not just for the half that changed).
 */
function PackageDdlEditorView({ objectRef, tabId }: PackageDdlEditorViewProps) {
  const { t } = useI18n();
  const configuration = useConfiguration();
  const readOnly = configuration["database.readOnly"];
  const driverId = ConnectionService.getProfile(objectRef.profileId)?.driverId;

  const [activeSectionId, setActiveSectionIdState] = useState<SectionId>(
    () => activeSectionIdByTabId.get(tabId) ?? "spec",
  );
  const [specBuffer, setSpecBuffer] = useState<SourceBuffer>(EMPTY_BUFFER);
  const [bodyBuffer, setBodyBuffer] = useState<SourceBuffer>(EMPTY_BUFFER);
  const [saving, setSaving] = useState(false);
  const [compileErrors, setCompileErrors] = useState<CompileErrorItem[]>([]);
  const [compileMessage, setCompileMessage] = useState<string | null>(null);
  const [revealRequest, setRevealRequest] = useState<{ name: string; nonce: number } | null>(
    null,
  );
  const editorInstanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const unregisterMonacoRef = useRef<() => void>(() => {});

  const setActiveSectionId = (id: SectionId) => {
    setActiveSectionIdState(id);
    activeSectionIdByTabId.set(tabId, id);
  };

  const loadBuffer = useCallback(
    (packageBody: boolean, setBuffer: (updater: (prev: SourceBuffer) => SourceBuffer) => void) => {
      setBuffer(() => ({ loaded: null, current: "", loading: true, error: null }));
      void bridgeFetchObjectDdl(
        objectRef.profileId,
        objectRef.schemaName,
        objectRef.objectName,
        "package",
        packageBody,
        objectRef.catalogName ?? undefined,
      )
        .then((result) => {
          const source = result.ddl.endsWith("\n") ? result.ddl : `${result.ddl}\n`;
          setBuffer(() => ({ loaded: source, current: source, loading: false, error: null }));
        })
        .catch((error) => {
          setBuffer(() => ({
            loaded: null,
            current: "",
            loading: false,
            error: formatErrorMessage(error, t("app.ddl.loadFailed")),
          }));
        });
    },
    [objectRef.profileId, objectRef.schemaName, objectRef.objectName, objectRef.catalogName, t],
  );

  useEffect(() => {
    loadBuffer(false, setSpecBuffer);
    loadBuffer(true, setBodyBuffer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectRef.profileId, objectRef.schemaName, objectRef.objectName, objectRef.catalogName]);

  useEffect(() => {
    return () => {
      unregisterMonacoRef.current();
    };
  }, []);

  const specDirty = specBuffer.loaded !== null && specBuffer.current !== specBuffer.loaded;
  const bodyDirty = bodyBuffer.loaded !== null && bodyBuffer.current !== bodyBuffer.loaded;
  // Matches ViewDdlEditor (procedure/function editor): Save doubles as "recompile", so it's
  // enabled whenever a source is loaded, not only when there are local edits — e.g. recompiling
  // after some other object invalidated this package, with nothing changed here locally.
  const canSave = !readOnly && !saving && !specBuffer.loading && !bodyBuffer.loading;

  const sectionRef = (packageBody: boolean): PlsqlEditorRef => ({
    profileId: objectRef.profileId,
    schemaName: objectRef.schemaName,
    kind: "package",
    objectName: objectRef.objectName,
    packageBody,
  });

  const handleOpenMember = (name: string) => {
    setRevealRequest({ name, nonce: Date.now() });
    setActiveSectionId("body");
  };

  /** Returns true if a match was found and revealed. */
  const revealMember = useCallback((instance: editor.IStandaloneCodeEditor, name: string) => {
    const model = instance.getModel();
    if (!model) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = model.findMatches(
      `\\b(PROCEDURE|FUNCTION)\\s+${escaped}\\b`,
      false,
      true,
      false,
      null,
      false,
      1,
    );
    if (matches.length === 0) return false;
    const range = matches[0].range;
    instance.revealLineInCenter(range.startLineNumber);
    instance.setSelection(range);
    instance.focus();
    return true;
  }, []);

  const handleBeforeMount = (monaco: Monaco) => {
    defineWorkbenchMonacoThemes(monaco);
    registerSqlLanguages(monaco);
  };

  const handleMount = useCallback((instance: editor.IStandaloneCodeEditor) => {
    editorInstanceRef.current = instance;
    unregisterMonacoRef.current();
    unregisterMonacoRef.current = registerMonacoInstance(instance);
  }, []);

  // Clears the ref whenever navigating away from Spec/Body so the reveal effect below never
  // mistakes a disposed editor (from a previous visit) for a live one while waiting for the next
  // mount to happen.
  useEffect(() => {
    if (activeSectionId !== "spec" && activeSectionId !== "body") {
      editorInstanceRef.current = null;
    }
  }, [activeSectionId]);

  // Single source of truth for "jump to declaration": polls until `editorInstanceRef.current`
  // exists *and* its model holds real content (not the `-- loading` placeholder) rather than
  // assuming any particular relationship with `onMount` — `@monaco-editor/react` reuses an
  // existing model for the same `path` verbatim on remount (ignoring the `value` prop it's given
  // at creation), and view-state restoration/model-reuse timing isn't something worth depending
  // on precisely. This runs identically whether this is the very first visit to Body or the
  // hundredth.
  useEffect(() => {
    if (!revealRequest || activeSectionId !== "body") return;
    let cancelled = false;
    let frame = 0;
    const tryReveal = () => {
      if (cancelled) return;
      const instance = editorInstanceRef.current;
      const model = instance?.getModel() ?? null;
      const content = model?.getValue() ?? "";
      const ready = Boolean(instance && model && content.trim() !== "" && !content.startsWith("-- "));
      if (ready && revealMember(instance!, revealRequest.name)) {
        setRevealRequest(null);
        return;
      }
      frame += 1;
      if (frame < 60) {
        window.requestAnimationFrame(tryReveal);
      } else {
        setRevealRequest(null);
      }
    };
    window.requestAnimationFrame(tryReveal);
    return () => {
      cancelled = true;
    };
  }, [revealRequest, activeSectionId, revealMember]);

  const performSave = async () => {
    if (!driverId) return;
    setSaving(true);
    setCompileErrors([]);
    setCompileMessage(null);
    try {
      // Matches ViewDdlEditor/executePlsqlSave (procedure & function editor): CREATE OR REPLACE
      // always re-executes for both halves, not only when locally dirty — Save/Compare&Save also
      // double as a plain "recompile", e.g. after some other object invalidated this package with
      // nothing changed here.
      {
        const ref = sectionRef(false);
        const { statements } = buildPlsqlSaveSql(specBuffer.current, ref, driverId);
        for (const statement of statements) {
          assertReadOnlyQueryAllowed(statement, readOnly);
        }
        for (const statement of statements) {
          await QueryExecutionService.executeWriteStatement(statement, {
            connectionId: objectRef.profileId,
          });
        }
      }
      {
        const ref = sectionRef(true);
        const { statements } = buildPlsqlSaveSql(bodyBuffer.current, ref, driverId);
        for (const statement of statements) {
          assertReadOnlyQueryAllowed(statement, readOnly);
        }
        for (const statement of statements) {
          await QueryExecutionService.executeWriteStatement(statement, {
            connectionId: objectRef.profileId,
          });
        }
      }

      // Matches DBeaver's OraclePackage.getCompileActions(): always recompile both halves,
      // not just the one that changed — body compilation depends on the spec being valid too.
      const [specResult, bodyResult] = await Promise.all([
        bridgeCompileObject(
          objectRef.profileId,
          objectRef.schemaName,
          objectRef.objectName,
          "package",
          false,
        ),
        bridgeCompileObject(
          objectRef.profileId,
          objectRef.schemaName,
          objectRef.objectName,
          "package",
          true,
        ),
      ]);
      const errors = [...specResult.errors, ...bodyResult.errors];
      setCompileErrors(errors);
      setCompileMessage(
        errors.length > 0
          ? t("app.plsql.compileFailedCount").replace("{n}", String(errors.length))
          : t("app.plsql.compileSucceeded"),
      );

      recordPlsqlSnapshot(sectionRef(false), specBuffer.current, "save");
      setSpecBuffer((prev) => ({ ...prev, loaded: prev.current }));
      recordPlsqlSnapshot(sectionRef(true), bodyBuffer.current, "save");
      setBodyBuffer((prev) => ({ ...prev, loaded: prev.current }));

      invalidateObjectPreviewCache(objectRef.profileId, objectRef.schemaName, objectRef.objectName);
      await ConnectionTreeService.invalidateAndRefreshSchema(
        objectRef.profileId,
        objectRef.schemaName,
      );
    } catch (error) {
      setSaving(false);
      throw error;
    }
    setSaving(false);
  };

  const handleSaveImmediate = () => {
    void performSave().catch((error: unknown) => {
      AppNotificationService.show(formatErrorMessage(error, t("app.ddl.saveFailed")), "error");
    });
  };

  const handleSaveClick = () => {
    // Matches PlsqlSaveDialogService (procedure/function editor): always show the diff dialog for
    // both halves, regardless of local dirty state — Compare & Save doubles as "recompile", and
    // the diff panel just legitimately shows "no changes" when that's true. The "before" side is
    // fetched fresh from the DB (not the cached `loaded` baseline) exactly like the routine editor.
    const nonce = PackagePlsqlSaveDialogService.open({
      objectLabel: `${objectRef.schemaName}.${objectRef.objectName}`,
      sections: [
        {
          id: "spec",
          label: t("app.objectEditor.specSection"),
          after: specBuffer.current,
          before: null,
          beforeLoading: true,
          beforeError: null,
        },
        {
          id: "body",
          label: t("app.objectEditor.bodySection"),
          after: bodyBuffer.current,
          before: null,
          beforeLoading: true,
          beforeError: null,
        },
      ],
      warnings: [],
      onConfirm: performSave,
    });

    for (const packageBody of [false, true] as const) {
      void bridgeFetchObjectDdl(
        objectRef.profileId,
        objectRef.schemaName,
        objectRef.objectName,
        "package",
        packageBody,
        objectRef.catalogName ?? undefined,
      )
        .then((result) => {
          const source = result.ddl.endsWith("\n") ? result.ddl : `${result.ddl}\n`;
          PackagePlsqlSaveDialogService.patchSection(nonce, packageBody ? "body" : "spec", {
            before: source,
            beforeLoading: false,
            beforeError: null,
          });
        })
        .catch((error: unknown) => {
          PackagePlsqlSaveDialogService.patchSection(nonce, packageBody ? "body" : "spec", {
            before: null,
            beforeLoading: false,
            beforeError: formatErrorMessage(
              error,
              "Failed to load current database source for diff.",
            ),
          });
        });
    }
  };

  const handleHistory = (section: "spec" | "body") => {
    const buffer = section === "spec" ? specBuffer : bodyBuffer;
    const ref = sectionRef(section === "body");
    PackagePlsqlHistoryDialogService.open({
      ref,
      objectLabel: buildPlsqlTabLabel(
        objectRef.schemaName,
        objectRef.objectName,
        "package",
        section === "body",
      ),
      currentContent: buffer.current,
      onRestore: (content) => {
        const setBuffer = section === "spec" ? setSpecBuffer : setBodyBuffer;
        setBuffer((prev) => ({ ...prev, current: content }));
      },
    });
  };

  const handleSnapshot = (section: "spec" | "body") => {
    const buffer = section === "spec" ? specBuffer : bodyBuffer;
    const entry = recordPlsqlSnapshot(sectionRef(section === "body"), buffer.current, "manual");
    AppNotificationService.show(
      entry ? t("app.plsql.snapshotSaved") : t("app.plsql.snapshotEmpty"),
      entry ? "info" : "error",
    );
  };

  const handleReload = async (section: "spec" | "body") => {
    const confirmed = await ConfirmDialogService.confirm({
      title: t("app.plsql.reloadFromDatabase"),
      message: t("app.plsql.reloadConfirm").replace(
        "{label}",
        buildPlsqlTabLabel(objectRef.schemaName, objectRef.objectName, "package", section === "body"),
      ),
      confirmLabel: t("app.plsql.reload"),
      danger: true,
    });
    if (!confirmed) return;
    loadBuffer(section === "body", section === "spec" ? setSpecBuffer : setBodyBuffer);
  };

  const renderSourceSection = (
    section: "spec" | "body",
    buffer: SourceBuffer,
    onChange: (value: string) => void,
  ) => {
    if (buffer.error) {
      return (
        <div className="table-property-section__status table-property-section__status--error">
          {buffer.error}
        </div>
      );
    }
    return (
      <div className="view-ddl-editor">
        <div className="view-ddl-editor__body">
          <Editor
            height="100%"
            // `key={section}` forces a real unmount/remount when switching Spec <-> Body —
            // without it, both branches render the identical `<Editor>` shape at the same tree
            // position, so React treats a section switch as a prop *update* on one persistent
            // instance and `onMount` never fires again after the first visit (see handleMount's
            // doc comment on the reveal-after-double-click bug this caused). `keepCurrentModel`
            // plus the distinct `path` below means the remount reattaches the *same* model
            // (content/undo history preserved) rather than losing it — only the editor view
            // itself is recreated.
            key={section}
            path={`silk-package-ddl://${tabId}/${section}`}
            keepCurrentModel
            language="plsql"
            value={
              buffer.loading ? `-- ${t("app.ddl.loading")}\n` : buffer.current
            }
            theme={monacoThemeForColorTheme(configuration["workbench.colorTheme"])}
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            onChange={(value) => {
              if (value === undefined || readOnly) return;
              onChange(value);
            }}
            options={{
              readOnly: readOnly || buffer.loading,
              fontFamily: getEditorFontFamily(),
              fontSize: configuration["editor.fontSize"],
              tabSize: configuration["editor.tabSize"],
              insertSpaces: configuration["editor.insertSpaces"],
              detectIndentation: false,
              lineNumbers: configuration["editor.lineNumbers"],
              renderLineHighlight: "line",
              minimap: { enabled: configuration["editor.minimap.enabled"] },
              stickyScroll: { enabled: configuration["editor.stickyScroll.enabled"] },
              wordWrap: configuration["editor.wordWrap"],
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    );
  };

  const showSourceToolbar = activeSectionId === "spec" || activeSectionId === "body";
  // Dependencies/Procedure/Function are genuinely read-only previews; Spec/Body are editable —
  // reusing the generic "read-only" banner text for those would be actively misleading (the same
  // reasoning ViewDdlEditor's own showGenericBanner split already follows).
  const bannerLabel = readOnly
    ? t("app.plsql.sourceReadOnly")
    : showSourceToolbar
      ? t("app.plsql.sourceLabel")
      : t("app.ddl.banner");

  return (
    <div className="ddl-editor-view">
      <div className="view-ddl-editor__banner" role="status">
        <span className="view-ddl-editor__banner-text">
          {bannerLabel}
          {` · ${objectRef.schemaName}.${objectRef.objectName}`}
          {compileMessage ? ` · ${compileMessage}` : ""}
        </span>
        {showSourceToolbar ? (
          <div className="view-ddl-editor__actions">
            <button
              type="button"
              className="view-ddl-editor__action"
              title={t("app.plsql.snapshotHistory")}
              onClick={() => handleHistory(activeSectionId as "spec" | "body")}
            >
              <Codicon name="history" />
              {t("app.plsql.actionHistory")}
            </button>
            <button
              type="button"
              className="view-ddl-editor__action"
              title={t("app.plsql.takeSnapshot")}
              onClick={() => handleSnapshot(activeSectionId as "spec" | "body")}
            >
              <Codicon name="save-all" />
              {t("app.plsql.actionSnapshot")}
            </button>
            <button
              type="button"
              className="view-ddl-editor__action"
              title={t("app.plsql.reloadFromDb")}
              onClick={() => void handleReload(activeSectionId as "spec" | "body")}
            >
              <Codicon name="refresh" />
              {t("app.plsql.actionReload")}
            </button>
            <button
              type="button"
              className="view-ddl-editor__action"
              disabled={!canSave}
              title={
                readOnly
                  ? t("app.plsql.readOnlyEnabled")
                  : compileErrors.length > 0
                    ? t("app.plsql.compileTitle")
                    : t("app.plsql.compileTitleNoDiagnostics")
              }
              onClick={handleSaveImmediate}
            >
              <Codicon name="save" />
              {saving ? t("common.executing") : t("app.plsql.actionCompile")}
            </button>
            <button
              type="button"
              className="view-ddl-editor__action"
              disabled={!canSave}
              title={
                readOnly
                  ? t("app.plsql.readOnlyEnabled")
                  : compileErrors.length > 0
                    ? t("app.plsql.saveTitle")
                    : t("app.plsql.saveTitleNoDiagnostics")
              }
              onClick={handleSaveClick}
            >
              <Codicon name="diff" />
              {saving ? t("common.executing") : t("app.plsql.actionSave")}
            </button>
          </div>
        ) : null}
      </div>
      {compileErrors.length > 0 ? (
        <div className="view-ddl-editor__errors" role="list">
          {compileErrors.map((item, index) => (
            <div
              key={`${index}-${item.line}-${item.column}-${item.message}`}
              className="view-ddl-editor__error view-ddl-editor__error--static"
              role="listitem"
            >
              <span className="view-ddl-editor__error-loc">
                {item.line}:{item.column}
              </span>
              <span className="view-ddl-editor__error-msg">{item.message}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="object-editor-properties-page">
        <div className="object-editor-properties">
          <aside className="object-editor-properties__sidebar">
            <nav className="object-editor-properties__nav">
              {PACKAGE_SECTIONS.map((section) => (
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
                  {(section.id === "spec" && specDirty) ||
                  (section.id === "body" && bodyDirty)
                    ? " *"
                    : ""}
                </button>
              ))}
            </nav>
          </aside>
          <div className="object-editor-properties__content">
            {activeSectionId === "dependencies" ? (
              <DependenciesPreview objectRef={objectRef} />
            ) : activeSectionId === "spec" ? (
              renderSourceSection("spec", specBuffer, (value) =>
                setSpecBuffer((prev) => ({ ...prev, current: value })),
              )
            ) : activeSectionId === "body" ? (
              renderSourceSection("body", bodyBuffer, (value) =>
                setBodyBuffer((prev) => ({ ...prev, current: value })),
              )
            ) : activeSectionId === "procedures" ? (
              <PackageMembersPreview
                objectRef={objectRef}
                memberKind="procedure"
                onOpenMember={handleOpenMember}
              />
            ) : (
              <PackageMembersPreview
                objectRef={objectRef}
                memberKind="function"
                onOpenMember={handleOpenMember}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PackageDdlEditorView;
