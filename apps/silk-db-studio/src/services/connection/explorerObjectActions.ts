import type {
  MetadataGroupId,
  MetadataObject,
  MetadataObjectKind,
} from "@silk-studio/db-protocol";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import type { ConnectionDriverId } from "./connectionTypes";
import {
  supportsDropObject,
  supportsRenameObject,
} from "./explorerObjectMutationSql";
import { supportsPlsqlSourceEdit } from "./plsqlEditorService";
import { supportsPackageCreation, supportsRoutineCreation } from "./createRoutineSql";

export type ExplorerObjectRef = {
  profileId: string;
  schemaName: string;
  object: MetadataObject;
  /** SQL Server catalog/database this object was resolved in, when not the session's current one. */
  catalogName?: string | null;
};

export type ExplorerMenuItem = {
  id: string;
  label: string;
  /** Command id when available; otherwise handled locally. */
  commandId?: string;
  enabled: boolean;
  /** Shown when the action is stubbed for a later milestone. */
  stubMessage?: string;
  /** Visual separator before this item. */
  separator?: boolean;
  /** Destructive action styling. */
  dangerous?: boolean;
};

export type ExplorerMenuOptions = {
  driverId?: ConnectionDriverId;
  readOnly?: boolean;
  /** Connected profile and writes allowed. */
  canMutate?: boolean;
};

export const EXPLORER_COMMANDS = {
  newTable: "silk.explorer.newTable",
  newTableSql: "silk.explorer.newTableSql",
  duplicateTable: "silk.explorer.duplicateTable",
  duplicateSqlObject: "silk.explorer.duplicateSqlObject",
  newIndex: "silk.explorer.newIndex",
  newTrigger: "silk.explorer.newTrigger",
  newProcedure: "silk.explorer.newProcedure",
  newFunction: "silk.explorer.newFunction",
  newPackage: "silk.explorer.newPackage",
  newView: "silk.explorer.newView",
  openObjectEditor: "silk.explorer.openObjectEditor",
  openObjectData: "silk.explorer.openObjectData",
  viewDdl: "silk.explorer.viewDdl",
  refreshSchema: "silk.explorer.refreshSchema",
  useDatabase: "silk.explorer.useDatabase",
  setDefaultDatabase: "silk.explorer.setDefaultDatabase",
  useSchema: "silk.explorer.useSchema",
  setDefaultSchema: "silk.explorer.setDefaultSchema",
  refreshCatalog: "silk.explorer.refreshCatalog",
  copyName: "silk.explorer.copyName",
  searchObjects: "silk.explorer.searchObjects",
  /** Opens the Ctrl+Shift+O quick pick pre-filled with a term and immediately runs a live search
   *  for it — see registerSqlCompletion.ts's "search all connections" completion item, which is
   *  this command's only caller today. */
  searchObjectsForTerm: "silk.explorer.searchObjectsForTerm",
  refresh: "silk.explorer.refresh",
  collapseAll: "silk.explorer.collapseAll",
  dropObject: "silk.explorer.dropObject",
  renameObject: "silk.explorer.renameObject",
  openSource: "silk.explorer.openSource",
  openPackageBody: "silk.explorer.openPackageBody",
} as const;

/**
 * Context menu shared by the Connections accordion header and the Explorer's
 * empty area. Keeping it here prevents the two entry points from drifting.
 */
export function buildConnectionsMenuItems(options: {
  hasConnectedProfiles: boolean;
  hasProfiles: boolean;
}): ExplorerMenuItem[] {
  return [
    {
      id: "newConnection",
      label: I18nService.t("workbench.explorer.newConnection"),
      commandId: "silk.connection.new",
      enabled: true,
    },
    {
      id: "disconnectAll",
      label: I18nService.t("common.disconnectAll"),
      commandId: "silk.connection.disconnectAll",
      enabled: options.hasConnectedProfiles,
      separator: false,
    },
    {
      id: "searchObjects",
      label: I18nService.t("workbench.explorer.searchObjects"),
      commandId: EXPLORER_COMMANDS.searchObjects,
      enabled: options.hasConnectedProfiles,
      separator: true,
    },
    {
      id: "refreshAll",
      label: I18nService.t("common.refresh"),
      commandId: EXPLORER_COMMANDS.refresh,
      enabled: options.hasConnectedProfiles,
    },
    {
      id: "collapseAll",
      label: I18nService.t("common.collapseAll"),
      commandId: EXPLORER_COMMANDS.collapseAll,
      enabled: options.hasConnectedProfiles,
    },
    {
      id: "exportConnections",
      label: I18nService.t("app.connection.exportTitle"),
      commandId: "silk.connection.exportAll",
      enabled: options.hasProfiles,
      separator: true,
    },
    {
      id: "importConnections",
      label: I18nService.t("app.connection.importTitle"),
      commandId: "silk.connection.import",
      enabled: true,
    },
  ];
}

/**
 * Indexes/sequences/synonyms/types are listed in the Explorer (v1) but have no DDL fetch wired
 * up in the jdbc-agent yet — every dialect's `fetchObjectDdl` only handles
 * table/view/procedure/function/package/trigger.
 */
export function supportsDdlView(kind: MetadataObjectKind): boolean {
  return (
    kind !== "index" &&
    kind !== "sequence" &&
    kind !== "synonym" &&
    kind !== "type"
  );
}

/** Default double-click / Enter action for an object kind. */
export function defaultObjectAction(
  kind: MetadataObjectKind,
  driverId?: ConnectionDriverId,
): "openObjectEditor" | "viewDdl" | "openSource" | null {
  if (kind === "table" || kind === "view") {
    return "openObjectEditor";
  }
  // Procedures/functions/packages always go through the unified DDL viewer tab now
  // (Dependencies/Arguments/Declaration for routines; Dependencies/Spec/Body/Procedure/Function
  // for packages, via PackageDdlEditorView) instead of the dedicated PL/SQL source tab — see
  // DdlEditorView.tsx and resolvePlsqlSourceRef's doc comment. The editable section renders
  // editable when supportsPlsqlSourceEdit is true for this driver, read-only otherwise; either
  // way "DDL 보기" (now labeled "속성 열기" for these kinds — see buildObjectMenuItems) is the
  // single entry point, so there's no more "editSource"/"editPackageBody" branch here for them.
  if (kind === "procedure" || kind === "function" || kind === "package") {
    return "viewDdl";
  }
  if (driverId && supportsPlsqlSourceEdit(driverId, kind)) {
    return "openSource";
  }
  return supportsDdlView(kind) ? "viewDdl" : null;
}

export function buildObjectMenuItems(
  kind: MetadataObjectKind,
  options: ExplorerMenuOptions = {},
): ExplorerMenuItem[] {
  const isRelation = kind === "table" || kind === "view";
  // Procedures/functions/packages merged "편집"/"편집(바디)"/"DDL 보기" into a single
  // "속성 열기" entry (the unified DdlEditorView tab — Dependencies/Arguments/Declaration for
  // routines, Dependencies/Spec/Body/Procedure/Function for packages via
  // PackageDdlEditorView) — see defaultObjectAction's doc comment.
  const isRoutine = kind === "procedure" || kind === "function" || kind === "package";
  const readOnly = options.readOnly ?? false;
  const driverId = options.driverId;
  const canMutate = options.canMutate ?? false;
  const canDrop =
    canMutate &&
    driverId !== undefined &&
    supportsDropObject(kind, driverId);
  const canRename =
    canMutate &&
    driverId !== undefined &&
    supportsRenameObject(kind, driverId);
  const t = I18nService.t.bind(I18nService);

  return [
    ...(isRelation
      ? [{
          id: "openObjectEditor",
          label: t("app.explorer.openProperties"),
          commandId: EXPLORER_COMMANDS.openObjectEditor,
          enabled: true,
        } satisfies ExplorerMenuItem,
        {
          id: "openObjectData",
          label: t("app.explorer.openData"),
          commandId: EXPLORER_COMMANDS.openObjectData,
          enabled: true,
        } satisfies ExplorerMenuItem]
      : []),
    {
      id: "viewDdl",
      label: isRoutine ? t("app.explorer.openProperties") : t("app.explorer.viewDdl"),
      commandId: EXPLORER_COMMANDS.viewDdl,
      enabled: supportsDdlView(kind),
      stubMessage: supportsDdlView(kind) ? undefined : t("app.explorer.stubViewDdl"),
    },
    {
      id: "copyName",
      label: t("app.explorer.copyName"),
      commandId: EXPLORER_COMMANDS.copyName,
      enabled: true,
    },
    ...(kind === "table"
      ? [
          {
            id: "newTable",
            label: t("app.explorer.newTable"),
            commandId: EXPLORER_COMMANDS.newTable,
            enabled: canMutate,
            separator: true,
            stubMessage: readOnly ? t("app.explorer.stubReadOnly") : undefined,
          } satisfies ExplorerMenuItem,
          {
            id: "duplicateTable",
            label: t("app.explorer.duplicateTable"),
            commandId: EXPLORER_COMMANDS.duplicateTable,
            enabled: canMutate,
            stubMessage: readOnly ? t("app.explorer.stubReadOnly") : undefined,
          } satisfies ExplorerMenuItem,
          {
            id: "newIndex",
            label: t("app.explorer.newIndex"),
            commandId: EXPLORER_COMMANDS.newIndex,
            enabled: canMutate,
            stubMessage: readOnly ? t("app.explorer.stubReadOnly") : undefined,
          } satisfies ExplorerMenuItem,
          {
            id: "newTrigger",
            label: t("app.explorer.newTrigger"),
            commandId: EXPLORER_COMMANDS.newTrigger,
            enabled: canMutate,
            stubMessage: readOnly ? t("app.explorer.stubReadOnly") : undefined,
          } satisfies ExplorerMenuItem,
        ]
      : [
          ...(kind === "view"
            ? [
                {
                  id: "newView",
                  label: t("app.explorer.newView"),
                  commandId: EXPLORER_COMMANDS.newView,
                  enabled: canMutate,
                  separator: true,
                  stubMessage: readOnly ? t("app.explorer.stubReadOnly") : undefined,
                } satisfies ExplorerMenuItem,
              ]
            : []),
          ...((kind === "procedure" || kind === "function") && driverId !== undefined && supportsRoutineCreation(driverId)
            ? [
                {
                  id: kind === "procedure" ? "newProcedure" : "newFunction",
                  label: t(kind === "procedure" ? "app.explorer.newProcedure" : "app.explorer.newFunction"),
                  commandId: kind === "procedure" ? EXPLORER_COMMANDS.newProcedure : EXPLORER_COMMANDS.newFunction,
                  enabled: canMutate,
                  separator: true,
                  stubMessage: readOnly ? t("app.explorer.stubReadOnly") : undefined,
                } satisfies ExplorerMenuItem,
              ]
            : []),
          ...(kind === "package" && driverId && supportsPackageCreation(driverId)
            ? [
                {
                  id: "newPackage",
                  label: t("app.explorer.newPackage"),
                  commandId: EXPLORER_COMMANDS.newPackage,
                  enabled: canMutate,
                  separator: true,
                  stubMessage: readOnly ? t("app.explorer.stubReadOnly") : undefined,
                } satisfies ExplorerMenuItem,
              ]
            : []),
          ...((kind === "view" || kind === "procedure" || kind === "function" || kind === "package")
            ? [{ id: "duplicateSqlObject", label: t(kind === "view" ? "app.explorer.duplicateView" : kind === "procedure" ? "app.explorer.duplicateProcedure" : kind === "function" ? "app.explorer.duplicateFunction" : "app.explorer.duplicatePackage"), commandId: EXPLORER_COMMANDS.duplicateSqlObject, enabled: canMutate, stubMessage: readOnly ? t("app.explorer.stubReadOnly") : undefined } satisfies ExplorerMenuItem]
            : []),
        ]),
    {
      id: "renameObject",
      label: t("app.explorer.renameEllipsis"),
      commandId: EXPLORER_COMMANDS.renameObject,
      enabled: canRename,
      separator: true,
      stubMessage: readOnly
        ? t("app.explorer.stubReadOnly")
        : driverId && !supportsRenameObject(kind, driverId)
          ? t("app.explorer.stubRename")
          : undefined,
    },
    {
      id: "dropObject",
      label: t("app.explorer.dropEllipsis"),
      commandId: EXPLORER_COMMANDS.dropObject,
      enabled: canDrop,
      dangerous: true,
      stubMessage: readOnly
        ? t("app.explorer.stubReadOnly")
        : driverId && !supportsDropObject(kind, driverId)
          ? t("app.explorer.stubDrop")
          : undefined,
    },
  ];
}

export function buildSchemaMenuItems(options?: {
  isDefault?: boolean;
}): ExplorerMenuItem[] {
  return [
    {
      id: "useSchema",
      label: I18nService.t("app.explorer.useSchema"),
      commandId: EXPLORER_COMMANDS.useSchema,
      enabled: true,
    },
    {
      id: "setDefaultSchema",
      label: I18nService.t("app.explorer.setDefaultSchema"),
      commandId: EXPLORER_COMMANDS.setDefaultSchema,
      enabled: !(options?.isDefault ?? false),
    },
    {
      id: "refreshSchema",
      label: I18nService.t("common.refresh"),
      commandId: EXPLORER_COMMANDS.refreshSchema,
      enabled: true,
      separator: true,
    },
  ];
}

/**
 * Connection profile row's context menu. Connection-specific actions are dispatched locally
 * against the clicked `profile.id`; global actions may safely use registered commands.
 */
export function buildProfileMenuItems(options: {
  isConnected: boolean;
  hasConnectedProfiles?: boolean;
}): ExplorerMenuItem[] {
  const hasConnectedProfiles = options.hasConnectedProfiles ?? options.isConnected;
  return [
    {
      id: "newQuery",
      label: I18nService.t("app.explorer.newQueryWithConnection"),
      enabled: true,
    },
    {
      id: "edit",
      label: I18nService.t("common.edit"),
      enabled: true,
      separator: true,
    },
    {
      id: "duplicate",
      label: I18nService.t("common.duplicate"),
      enabled: true,
    },
    {
      id: "delete",
      label: I18nService.t("common.delete"),
      enabled: true,
      dangerous: true,
    },
    {
      id: "newConnection",
      label: I18nService.t("workbench.explorer.newConnection"),
      commandId: "silk.connection.new",
      enabled: true,
      separator: true,
    },
    {
      id: options.isConnected ? "disconnect" : "connect",
      label: I18nService.t(
        options.isConnected ? "common.disconnect" : "common.connect",
      ),
      enabled: true,
    },
    {
      id: "reconnect",
      label: I18nService.t("app.explorer.reconnect"),
      enabled: true,
    },
    {
      id: "disconnectAll",
      label: I18nService.t("common.disconnectAll"),
      commandId: "silk.connection.disconnectAll",
      enabled: hasConnectedProfiles,
    },
    {
      id: "searchObjects",
      label: I18nService.t("workbench.explorer.searchObjects"),
      commandId: EXPLORER_COMMANDS.searchObjects,
      enabled: hasConnectedProfiles,
      separator: true,
    },
    {
      id: "refresh",
      label: I18nService.t("common.refresh"),
      enabled: options.isConnected,
    },
    {
      id: "collapseProfile",
      label: I18nService.t("common.collapseAll"),
      enabled: options.isConnected,
    },
    {
      id: "exportConnections",
      label: I18nService.t("workbench.commands.exportConnections"),
      commandId: "silk.connection.exportAll",
      enabled: true,
      separator: true,
    },
    {
      id: "importConnections",
      label: I18nService.t("workbench.commands.importConnections"),
      enabled: true,
      commandId: "silk.connection.import",
    },
  ];
}

export function buildCatalogMenuItems(options?: {
  isCurrent?: boolean;
  isDefault?: boolean;
}): ExplorerMenuItem[] {
  return [
    {
      id: "useDatabase",
      label: I18nService.t("app.explorer.useDatabase"),
      commandId: EXPLORER_COMMANDS.useDatabase,
      enabled: !(options?.isCurrent ?? false),
    },
    {
      id: "setDefaultDatabase",
      label: I18nService.t("app.explorer.setDefaultDatabase"),
      commandId: EXPLORER_COMMANDS.setDefaultDatabase,
      enabled: !(options?.isDefault ?? false),
    },
    {
      id: "refreshCatalog",
      label: I18nService.t("common.refresh"),
      commandId: EXPLORER_COMMANDS.refreshCatalog,
      enabled: true,
      separator: true,
    },
  ];
}

export function buildGroupMenuItems(options: {
  groupId: MetadataGroupId;
  canMutate: boolean;
  readOnly: boolean;
  driverId?: ConnectionDriverId;
}): ExplorerMenuItem[] {
  const isTablesGroup = options.groupId === "tables";
  const routineKind =
    options.groupId === "procedures"
      ? "procedure"
      : options.groupId === "functions"
        ? "function"
        : null;
  const isPackagesGroup = options.groupId === "packages";
  return [
    ...(isTablesGroup
      ? [
          {
            id: "newTable",
            label: I18nService.t("app.explorer.newTable"),
            commandId: EXPLORER_COMMANDS.newTable,
            enabled: options.canMutate,
            stubMessage: options.readOnly
              ? I18nService.t("app.explorer.stubReadOnly")
              : undefined,
          } satisfies ExplorerMenuItem,
          {
            id: "newTableSql",
            label: "SQL로 새 테이블 만들기…",
            commandId: EXPLORER_COMMANDS.newTableSql,
            enabled: options.canMutate,
            stubMessage: options.readOnly
              ? I18nService.t("app.explorer.stubReadOnly")
              : undefined,
          } satisfies ExplorerMenuItem,
        ]
      : []),
    ...(options.groupId === "views"
      ? [{ id: "newView", label: I18nService.t("app.explorer.newView"), commandId: EXPLORER_COMMANDS.newView, enabled: options.canMutate, stubMessage: options.readOnly ? I18nService.t("app.explorer.stubReadOnly") : undefined } satisfies ExplorerMenuItem]
      : []),
    ...(routineKind && options.driverId && supportsRoutineCreation(options.driverId)
      ? [
          {
            id: `new${routineKind === "procedure" ? "Procedure" : "Function"}`,
            label: I18nService.t(
              routineKind === "procedure"
                ? "app.explorer.newProcedure"
                : "app.explorer.newFunction",
            ),
            commandId:
              routineKind === "procedure"
                ? EXPLORER_COMMANDS.newProcedure
                : EXPLORER_COMMANDS.newFunction,
            enabled: options.canMutate,
            stubMessage: options.readOnly
              ? I18nService.t("app.explorer.stubReadOnly")
              : undefined,
          } satisfies ExplorerMenuItem,
        ]
      : []),
    ...(isPackagesGroup && options.driverId && supportsPackageCreation(options.driverId)
      ? [
          {
            id: "newPackage",
            label: I18nService.t("app.explorer.newPackage"),
            commandId: EXPLORER_COMMANDS.newPackage,
            enabled: options.canMutate,
            stubMessage: options.readOnly
              ? I18nService.t("app.explorer.stubReadOnly")
              : undefined,
          } satisfies ExplorerMenuItem,
        ]
      : []),
    {
      id: "refreshGroup",
      label: I18nService.t("common.refresh"),
      commandId: EXPLORER_COMMANDS.refreshSchema,
      enabled: true,
      separator: isTablesGroup || options.groupId === "views" || routineKind !== null || isPackagesGroup,
    },
    {
      id: "collapseAll",
      label: I18nService.t("common.collapseAll"),
      commandId: EXPLORER_COMMANDS.collapseAll,
      enabled: true,
    },
    {
      id: "newConnection",
      label: I18nService.t("workbench.explorer.newConnection"),
      commandId: "silk.connection.new",
      enabled: true,
      separator: true,
    },
    {
      id: "exportConnections",
      label: I18nService.t("app.connection.exportTitle"),
      commandId: "silk.connection.exportAll",
      enabled: true,
    },
    {
      id: "importConnections",
      label: I18nService.t("app.connection.importTitle"),
      commandId: "silk.connection.import",
      enabled: true,
    },
  ];
}

export function formatQualifiedName(
  schemaName: string,
  objectName: string,
  options?: { databaseName?: string; driverId?: ConnectionDriverId },
): string {
  const databaseName = options?.databaseName?.trim();
  if (options?.driverId === "sqlserver" && databaseName) {
    return `${databaseName}.${schemaName}.${objectName}`;
  }
  return `${schemaName}.${objectName}`;
}
