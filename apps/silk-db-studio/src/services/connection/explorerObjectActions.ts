import type { MetadataObject, MetadataObjectKind } from "@silk-studio/db-protocol";
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
  openData: "silk.explorer.openData",
  viewDdl: "silk.explorer.viewDdl",
  refreshSchema: "silk.explorer.refreshSchema",
  copyName: "silk.explorer.copyName",
  searchObjects: "silk.explorer.searchObjects",
  refresh: "silk.explorer.refresh",
  collapseAll: "silk.explorer.collapseAll",
  dropObject: "silk.explorer.dropObject",
  renameObject: "silk.explorer.renameObject",
  openSource: "silk.explorer.openSource",
  openPackageBody: "silk.explorer.openPackageBody",
} as const;

/** Default double-click / Enter action for an object kind. */
export function defaultObjectAction(
  kind: MetadataObjectKind,
  driverId?: ConnectionDriverId,
): "openData" | "viewDdl" | "openSource" {
  if (kind === "table" || kind === "view") {
    return "openData";
  }
  if (driverId && supportsPlsqlSourceEdit(driverId, kind)) {
    return "openSource";
  }
  return "viewDdl";
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
  const canEditSource =
    driverId !== undefined && supportsPlsqlSourceEdit(driverId, kind);
  const isPackage = kind === "package";

  return [
    {
      id: "openData",
      label: "Open Data",
      commandId: EXPLORER_COMMANDS.openData,
      enabled: isRelation,
    },
    {
      id: "editSource",
      label: isPackage ? "Edit Spec" : "Edit",
      commandId: EXPLORER_COMMANDS.openSource,
      enabled: canEditSource,
      stubMessage:
        driverId && !supportsPlsqlSourceEdit(driverId, kind)
          ? "Edit is available for Oracle procedures, functions, and packages."
          : undefined,
    },
    ...(isPackage
      ? [
          {
            id: "editPackageBody",
            label: "Edit Body",
            commandId: EXPLORER_COMMANDS.openPackageBody,
            enabled: canEditSource,
          } satisfies ExplorerMenuItem,
        ]
      : []),
    {
      id: "viewDdl",
      label: "View DDL",
      commandId: EXPLORER_COMMANDS.viewDdl,
      enabled: true,
    },
    {
      id: "copyName",
      label: "Copy Name",
      commandId: EXPLORER_COMMANDS.copyName,
      enabled: true,
    },
    {
      id: "renameObject",
      label: "Rename…",
      commandId: EXPLORER_COMMANDS.renameObject,
      enabled: canRename,
      separator: true,
      stubMessage: readOnly
        ? "Read-only mode is enabled."
        : driverId && !supportsRenameObject(kind, driverId)
          ? "Rename is only supported on Oracle and PostgreSQL (tables/views) in v1."
          : undefined,
    },
    {
      id: "dropObject",
      label: "Drop…",
      commandId: EXPLORER_COMMANDS.dropObject,
      enabled: canDrop,
      dangerous: true,
      stubMessage: readOnly
        ? "Read-only mode is enabled."
        : driverId && !supportsDropObject(kind, driverId)
          ? "DROP is not supported for this object on this driver."
          : undefined,
    },
  ];
}

export function buildSchemaMenuItems(): ExplorerMenuItem[] {
  return [
    {
      id: "refreshSchema",
      label: "Refresh",
      commandId: EXPLORER_COMMANDS.refreshSchema,
      enabled: true,
    },
  ];
}

export function buildGroupMenuItems(): ExplorerMenuItem[] {
  return [
    {
      id: "refreshGroup",
      label: "Refresh",
      commandId: EXPLORER_COMMANDS.refreshSchema,
      enabled: true,
    },
  ];
}

export function formatQualifiedName(
  schemaName: string,
  objectName: string,
): string {
  return `${schemaName}.${objectName}`;
}
