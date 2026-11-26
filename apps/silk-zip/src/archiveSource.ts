import { resourceIcon } from "@silk-studio/workbench/components/explorer/resourceExplorerTypes.ts";
import type { ResourceNode, ResourceSource } from "@silk-studio/workbench/components/explorer/resourceExplorerTypes.ts";
import type { ArchiveListing } from "./archive";

/** The archive itself is the root of the tree; it shows as an archive, not as a folder. */
function archiveIcon(archive: ArchiveListing) {
  const file = archive.path.split(/[\\/]/).pop() ?? archive.path;
  // "a.7z.001" and "a.z01" are parts of a split archive: show the format, not the part number.
  return resourceIcon({ id: "", name: file.replace(/\.(?:\d{3}|z\d{2})$/i, ""), directory: false });
}

/** The archive details shown in the optional columns. */
function entryMeta(entry: ArchiveListing["entries"][number]): ResourceNode["meta"] {
  return { packedSize: entry.packedSize, modified: entry.modified, crc: entry.crc, method: entry.method, encryption: entry.encryption, attributes: entry.attributes };
}

const statusLabel = (status: "added" | "renamed" | undefined) => (status === "added" ? "추가됨" : status === "renamed" ? "이름 변경됨" : undefined);

/** Build virtual directories, including folders absent from the archive headers.
 * IDs are opaque and are never used as filesystem paths or extraction targets. */
export function createArchiveSource(archive: ArchiveListing): ResourceSource {
  const root: ResourceNode = { id: "directory:[]", name: archive.path.split(/[\\/]/).pop() || archive.path, directory: true, icon: archiveIcon(archive) };
  const children = new Map<string, ResourceNode[]>([[root.id, []]]);
  archive.entries.forEach((entry, index) => {
    const segments = entry.path.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
    let parentId = root.id;
    segments.forEach((name, depth) => {
      const directory = depth < segments.length - 1 || entry.directory;
      const id = directory ? `directory:${JSON.stringify(segments.slice(0, depth + 1))}` : `entry:${index}`;
      if (directory) {
        if (!children.has(id)) {
          children.set(id, []);
          children.get(parentId)!.push({ id, name, directory: true, status: depth === segments.length - 1 ? statusLabel(entry.status) : undefined, location: depth === segments.length - 1 ? entry.sourcePath ?? undefined : undefined, meta: depth === segments.length - 1 ? entryMeta(entry) : undefined });
        }
      } else {
        children.get(parentId)!.push({ id, name, directory: false, size: entry.size, encrypted: entry.encrypted, status: statusLabel(entry.status), location: entry.sourcePath ?? undefined, meta: entryMeta(entry) });
      }
      parentId = id;
    });
  });
  return { root, readChildren: async (id) => {
    // A folder removed by a pending change simply shows as empty.
    return children.get(id) ?? [];
  } };
}

/** One searchable item: a listed file or folder (including folders implied by file paths). */
export interface SearchItem {
  id: string;
  name: string;
  directory: boolean;
  /** Folder that holds the item ("" for the root). */
  parent: string;
  /** Full archive path ("a/b/c"). */
  path: string;
}

const splitPath = (path: string) => path.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");

/** Flat list of every item, with the same node IDs `createArchiveSource` uses. */
export function buildSearchIndex(archive: ArchiveListing): SearchItem[] {
  const items = new Map<string, SearchItem>();
  archive.entries.forEach((entry, index) => {
    const segments = splitPath(entry.path);
    segments.forEach((name, depth) => {
      const directory = depth < segments.length - 1 || entry.directory;
      const id = directory ? `directory:${JSON.stringify(segments.slice(0, depth + 1))}` : `entry:${index}`;
      if (items.has(id)) return;
      items.set(id, { id, name, directory, parent: segments.slice(0, depth).join("/"), path: segments.slice(0, depth + 1).join("/") });
    });
  });
  return [...items.values()];
}

/** Folder chain (root first) down to `folder`, matching the nodes of `createArchiveSource`. */
export function archiveRoute(archive: ArchiveListing, folder: string): ResourceNode[] {
  const segments = splitPath(folder);
  const route: ResourceNode[] = [{ id: "directory:[]", name: archive.path.split(/[\\/]/).pop() || archive.path, directory: true, icon: archiveIcon(archive) }];
  segments.forEach((name, depth) => route.push({ id: `directory:${JSON.stringify(segments.slice(0, depth + 1))}`, name, directory: true }));
  return route;
}

/** Archive-relative path ("a/b/c") of a listed node, or null for the archive root. */
export function archiveNodePath(archive: ArchiveListing, node: ResourceNode): string | null {
  const clean = (path: string) => path.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".").join("/");
  if (node.id.startsWith("directory:")) {
    try {
      const segments: unknown = JSON.parse(node.id.slice("directory:".length));
      return Array.isArray(segments) && segments.length ? clean(segments.join("/")) : null;
    } catch {
      return null;
    }
  }
  if (node.id.startsWith("entry:")) {
    const entry = archive.entries[Number(node.id.slice("entry:".length))];
    return entry ? clean(entry.path) || null : null;
  }
  return null;
}

/** Names of the entries that share a parent folder with `path` (including `path` itself). */
export function siblingNames(archive: ArchiveListing, path: string): string[] {
  const parts = path.split("/");
  const parent = parts.slice(0, -1).join("/");
  const names = new Set<string>();
  for (const entry of archive.entries) {
    const segments = entry.path.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
    if (segments.length > parts.length - 1 && segments.slice(0, parts.length - 1).join("/") === parent) names.add(segments[parts.length - 1]);
  }
  return [...names];
}
