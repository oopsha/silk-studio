import type { MetadataObjectKind } from "@silk-studio/db-protocol";

export const PLSQL_EDITOR_URI_PREFIX = "silk://plsql/";

export const PLSQL_SOURCE_LOADING = "-- Loading source...\n";

export type PlsqlEditorRef = {
  profileId: string;
  schemaName: string;
  kind: MetadataObjectKind;
  objectName: string;
  /**
   * Only for `kind === "package"`:
   * - `true` → PACKAGE BODY tab (`…/body`)
   * - `false` / omit → PACKAGE (spec)
   */
  packageBody?: boolean;
};

export function isPackageBodyRef(ref: PlsqlEditorRef): boolean {
  return ref.kind === "package" && ref.packageBody === true;
}

export function plsqlEditorUri(ref: PlsqlEditorRef): string {
  const base =
    `${PLSQL_EDITOR_URI_PREFIX}` +
    `${encodeURIComponent(ref.profileId)}/` +
    `${encodeURIComponent(ref.schemaName)}/` +
    `${encodeURIComponent(ref.kind)}/` +
    `${encodeURIComponent(ref.objectName)}`;
  if (isPackageBodyRef(ref)) {
    return `${base}/body`;
  }
  return base;
}

export function parsePlsqlEditorUri(uri: string | undefined): PlsqlEditorRef | null {
  if (!uri?.startsWith(PLSQL_EDITOR_URI_PREFIX)) return null;
  const rest = uri.slice(PLSQL_EDITOR_URI_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length !== 4 && parts.length !== 5) return null;
  try {
    const profileId = decodeURIComponent(parts[0]);
    const schemaName = decodeURIComponent(parts[1]);
    const kind = decodeURIComponent(parts[2]) as MetadataObjectKind;
    const objectName = decodeURIComponent(parts[3]);
    if (!profileId || !schemaName || !objectName) return null;

    let packageBody: boolean | undefined;
    if (parts.length === 5) {
      const segment = decodeURIComponent(parts[4]).toLowerCase();
      if (segment !== "body" || kind !== "package") return null;
      packageBody = true;
    }

    return { profileId, schemaName, kind, objectName, packageBody };
  } catch {
    return null;
  }
}

export function isPlsqlEditorTab(uri: string | undefined): boolean {
  return parsePlsqlEditorUri(uri) !== null;
}

function kindShortLabel(ref: Pick<PlsqlEditorRef, "kind" | "packageBody">): string {
  switch (ref.kind) {
    case "procedure":
      return "PROC";
    case "function":
      return "FUNC";
    case "package":
      return ref.packageBody ? "PKG BODY" : "PKG SPEC";
    default:
      return ref.kind.toUpperCase();
  }
}

export function buildPlsqlTabLabel(
  schemaName: string,
  objectName: string,
  kind: MetadataObjectKind,
  packageBody?: boolean,
): string {
  return `${schemaName}.${objectName} (${kindShortLabel({ kind, packageBody })})`;
}

export function isPlsqlSourceLoaded(content: string | undefined): boolean {
  if (!content?.trim()) return false;
  return (
    !content.startsWith(PLSQL_SOURCE_LOADING.trim()) &&
    !content.startsWith("-- Failed to load source")
  );
}
