import type { MetadataObjectKind } from "@silk-studio/db-protocol";

export const OBJECT_EDITOR_URI_PREFIX = "silk://object/";

export type ObjectEditorRef = {
  profileId: string;
  schemaName: string;
  kind: MetadataObjectKind;
  objectName: string;
};

export function objectEditorUri(ref: ObjectEditorRef): string {
  return (
    `${OBJECT_EDITOR_URI_PREFIX}` +
    `${encodeURIComponent(ref.profileId)}/` +
    `${encodeURIComponent(ref.schemaName)}/` +
    `${encodeURIComponent(ref.kind)}/` +
    `${encodeURIComponent(ref.objectName)}`
  );
}

export function parseObjectEditorUri(uri: string | undefined): ObjectEditorRef | null {
  if (!uri?.startsWith(OBJECT_EDITOR_URI_PREFIX)) return null;
  const rest = uri.slice(OBJECT_EDITOR_URI_PREFIX.length);
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

export function isObjectEditorTab(uri: string | undefined): boolean {
  return parseObjectEditorUri(uri) !== null;
}

export function buildObjectEditorTabLabel(schemaName: string, objectName: string): string {
  return `${schemaName}.${objectName}`;
}
