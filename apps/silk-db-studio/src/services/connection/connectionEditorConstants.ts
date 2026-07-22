export const CONNECTION_EDITOR_URI_PREFIX = "silk://connection/";

export function connectionEditorUri(profileId: string | "new"): string {
  return `${CONNECTION_EDITOR_URI_PREFIX}${profileId}`;
}

export function parseConnectionEditorUri(
  uri: string | undefined,
): string | "new" | null {
  if (!uri?.startsWith(CONNECTION_EDITOR_URI_PREFIX)) return null;
  const id = uri.slice(CONNECTION_EDITOR_URI_PREFIX.length);
  if (!id) return null;
  return id === "new" ? "new" : id;
}
