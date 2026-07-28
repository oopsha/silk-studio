import type { MetadataObjectKind } from "@silk-studio/db-protocol";

export const PLSQL_EDITOR_URI_PREFIX = "silk://plsql/";

export const PLSQL_SOURCE_LOADING = "-- Loading source...\n";

export type PlsqlEditorRef = {
  profileId: string;
  schemaName: string;
  kind: MetadataObjectKind;
  objectName: string;
};

export function plsqlEditorUri(ref: PlsqlEditorRef): string {
  return (
    `${PLSQL_EDITOR_URI_PREFIX}` +
    `${encodeURIComponent(ref.profileId)}/` +
    `${encodeURIComponent(ref.schemaName)}/` +
    `${encodeURIComponent(ref.kind)}/` +
    `${encodeURIComponent(ref.objectName)}`
  );
}

export function parsePlsqlEditorUri(uri: string | undefined): PlsqlEditorRef | null {
  if (!uri?.startsWith(PLSQL_EDITOR_URI_PREFIX)) return null;
  const rest = uri.slice(PLSQL_EDITOR_URI_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length !== 4) return null;
  try {
    const profileId = decodeURIComponent(parts[0]);
    const schemaName = decodeURIComponent(parts[1]);
    const kind = decodeURIComponent(parts[2]) as MetadataObjectKind;
    const objectName = decodeURIComponent(parts[3]);
    if (!profileId || !schemaName || !objectName) return null;
    return { profileId, schemaName, kind, objectName };
  } catch {
    return null;
  }
}

export function isPlsqlEditorTab(uri: string | undefined): boolean {
  return parsePlsqlEditorUri(uri) !== null;
}

function kindShortLabel(kind: MetadataObjectKind): string {
  switch (kind) {
    case "procedure":
      return "PROC";
    case "function":
      return "FUNC";
    case "package":
      return "PKG";
    default:
      return kind.toUpperCase();
  }
}

export function buildPlsqlTabLabel(
  schemaName: string,
  objectName: string,
  kind: MetadataObjectKind,
): string {
  return `${schemaName}.${objectName} (${kindShortLabel(kind)})`;
}

export function isPlsqlSourceLoaded(content: string | undefined): boolean {
  if (!content?.trim()) return false;
  return (
    !content.startsWith(PLSQL_SOURCE_LOADING.trim()) &&
    !content.startsWith("-- Failed to load source")
  );
}
