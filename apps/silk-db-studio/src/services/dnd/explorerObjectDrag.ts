/** Custom MIME for Connections explorer → SQL editor drops. */
export const SILK_EXPLORER_OBJECT_MIME = "application/x-silk-explorer-object";

export type SilkExplorerObjectDragPayload = {
  schemaName: string;
  objectName: string;
  kind?: string;
  profileId?: string;
};

export function encodeExplorerObjectDrag(
  payload: SilkExplorerObjectDragPayload,
): string {
  return JSON.stringify(payload);
}

export function decodeExplorerObjectDrag(
  raw: string,
): SilkExplorerObjectDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SilkExplorerObjectDragPayload>;
    const schemaName = parsed.schemaName?.trim();
    const objectName = parsed.objectName?.trim();
    if (!schemaName || !objectName) return null;
    return {
      schemaName,
      objectName,
      kind: parsed.kind,
      profileId: parsed.profileId,
    };
  } catch {
    return null;
  }
}

export function isExplorerObjectDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes(SILK_EXPLORER_OBJECT_MIME);
}
