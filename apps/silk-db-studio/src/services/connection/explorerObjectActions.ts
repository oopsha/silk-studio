import type { MetadataObject, MetadataObjectKind } from "@silk-studio/db-protocol";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import type { ConnectionDriverId } from "./connectionTypes";
import {
  supportsDropObject,
  supportsRenameObject,
} from "./explorerObjectMutationSql";
import { supportsPlsqlSourceEdit } from "./plsqlEditorService";

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
  openObjectEditor: "silk.explorer.openObjectEditor",
  viewDdl: "silk.explorer.viewDdl",
  refreshSchema: "silk.explorer.refreshSchema",
  useDatabase: "silk.explorer.useDatabase",
  setDefaultDatabase: "silk.explorer.setDefaultDatabase",
  refreshCatalog: "silk.explorer.refreshCatalog",
  copyName: "silk.explorer.copyName",
  searchObjects: "silk.explorer.searchObjects",
  refresh: "silk.explorer.refresh",
  collapseAll: "silk.explorer.collapseAll",
  dropObject: "silk.explorer.dropObject",
  renameObject: "silk.explorer.renameObject",
  openSource: "silk.explorer.openSource",
  openPackageBody: "silk.explorer.openPackageBody",
} as const;

/**
 * Indexes/sequences/synonyms/triggers/types are listed in the Explorer (v1) but have no DDL
 * fetch wired up in the jdbc-agent yet — every dialect's `fetchObjectDdl` only handles
 * table/view/procedure/function/package.
 */
export function supportsDdlView(kind: MetadataObjectKind): boolean {
  return (
    kind !== "index" &&
    kind !== "sequence" &&
    kind !== "synonym" &&
    kind !== "trigger" &&
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
  // Relations (table/view) have their own "openObjectEditor" entry above — a view's DDL is
  // editable there (Properties → DDL), not via this "edit source" entry, which is only for
  // the dedicated PL/SQL source tab (procedure/function/package). Without this guard, once
  // `supportsPlsqlSourceEdit` also covers views (for the Object Editor's DDL section), this
  // menu item would incorrectly enable and route a view to the wrong tab type.
  const canEditSource =
    !isRelation && driverId !== undefined && supportsPlsqlSourceEdit(driverId, kind);
  const isPackage = kind === "package";
  const t = I18nService.t.bind(I18nService);

  return [
    {
      id: "openObjectEditor",
      label: t("app.explorer.openData"),
      commandId: EXPLORER_COMMANDS.openObjectEditor,
      enabled: isRelation,
    },
    {
      id: "editSource",
      label: isPackage ? t("app.explorer.editSpec") : t("common.edit"),
      commandId: EXPLORER_COMMANDS.openSource,
      enabled: canEditSource,
      stubMessage:
        driverId && !supportsPlsqlSourceEdit(driverId, kind)
          ? t("app.explorer.stubEditOracle")
          : undefined,
    },
    ...(isPackage
      ? [
          {
            id: "editPackageBody",
            label: t("app.explorer.editBody"),
            commandId: EXPLORER_COMMANDS.openPackageBody,
            enabled: canEditSource,
          } satisfies ExplorerMenuItem,
        ]
      : []),
    {
      id: "viewDdl",
      label: t("app.explorer.viewDdl"),
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

export function buildSchemaMenuItems(): ExplorerMenuItem[] {
  return [
    {
      id: "refreshSchema",
      label: I18nService.t("common.refresh"),
      commandId: EXPLORER_COMMANDS.refreshSchema,
      enabled: true,
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

export function buildGroupMenuItems(): ExplorerMenuItem[] {
  return [
    {
      id: "refreshGroup",
      label: I18nService.t("common.refresh"),
      commandId: EXPLORER_COMMANDS.refreshSchema,
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
