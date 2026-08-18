import type { MetadataObjectKind } from "@silk-studio/db-protocol";

export const DDL_EDITOR_URI_PREFIX = "silk://ddl/";

export type DdlEditorRef = {
  profileId: string;
  schemaName: string;
  kind: MetadataObjectKind;
  objectName: string;
  /** SQL Server catalog/database the object was resolved in, when not the session's current one. */
  catalogName?: string | null;
};

export function ddlEditorUri(ref: DdlEditorRef): string {
  const base =
    `${DDL_EDITOR_URI_PREFIX}` +
    `${encodeURIComponent(ref.profileId)}/` +
    `${encodeURIComponent(ref.schemaName)}/` +
    `${encodeURIComponent(ref.kind)}/` +
    `${encodeURIComponent(ref.objectName)}`;
  const catalog = ref.catalogName?.trim();
  return catalog ? `${base}?catalog=${encodeURIComponent(catalog)}` : base;
}

export function parseDdlEditorUri(uri: string | undefined): DdlEditorRef | null {
  if (!uri?.startsWith(DDL_EDITOR_URI_PREFIX)) return null;
  const rest = uri.slice(DDL_EDITOR_URI_PREFIX.length);
  const [path, query] = rest.split("?", 2);
  const parts = path.split("/");
  if (parts.length !== 4) return null;
  try {
    const profileId = decodeURIComponent(parts[0]);
    const schemaName = decodeURIComponent(parts[1]);
    const kind = decodeURIComponent(parts[2]) as MetadataObjectKind;
    const objectName = decodeURIComponent(parts[3]);
    if (!profileId || !schemaName || !objectName) return null;
    const catalogName = query
      ? (new URLSearchParams(query).get("catalog") ?? undefined)
      : undefined;
    return { profileId, schemaName, kind, objectName, catalogName };
  } catch {
    return null;
  }
}

export function isDdlEditorTab(uri: string | undefined): boolean {
  return parseDdlEditorUri(uri) !== null;
}

export function buildDdlTabLabel(schemaName: string, objectName: string): string {
  return `DDL — ${schemaName}.${objectName}`;
}
