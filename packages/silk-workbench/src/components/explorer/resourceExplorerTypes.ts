export type ResourceNode = {
  id: string;
  name: string;
  directory: boolean;
  size?: number | null;
  encrypted?: boolean;
};

/** The source owns paths and I/O; views only use opaque node IDs. */
export type ResourceSource = {
  root: ResourceNode;
  readChildren: (directoryId: string) => Promise<readonly ResourceNode[]>;
};

export function sortResources(nodes: readonly ResourceNode[]): ResourceNode[] {
  return [...nodes].sort((a, b) => Number(b.directory) - Number(a.directory)
    || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function resourceIcon(node: ResourceNode): { name: string; className: string } {
  if (node.directory) return { name: "folder", className: "resource-icon--folder" };
  const extension = node.name.split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "7z", "rar", "tar", "gz", "bz2", "xz", "zst"].includes(extension)) {
    return { name: "file-zip", className: "resource-icon--archive" };
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(extension)) {
    return { name: "file-media", className: "resource-icon--media" };
  }
  if (extension === "pdf") return { name: "file-pdf", className: "resource-icon--pdf" };
  if (["java", "js", "jsx", "ts", "tsx", "json", "rs", "py", "html", "css", "xml", "yaml", "yml"].includes(extension)) {
    return { name: "file-code", className: "resource-icon--code" };
  }
  return { name: "file-text", className: "resource-icon--text" };
}
