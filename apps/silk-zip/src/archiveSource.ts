import type { ResourceNode, ResourceSource } from "@silk-studio/workbench/components/explorer/resourceExplorerTypes.ts";
import type { ArchiveListing } from "./archive";

/** Build virtual directories, including folders absent from the archive headers.
 * IDs are opaque and are never used as filesystem paths or extraction targets. */
export function createArchiveSource(archive: ArchiveListing): ResourceSource {
  const root: ResourceNode = { id: "directory:[]", name: archive.path.split(/[\\/]/).pop() || archive.path, directory: true };
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
          children.get(parentId)!.push({ id, name, directory: true });
        }
      } else {
        children.get(parentId)!.push({ id, name, directory: false, size: entry.size, encrypted: entry.encrypted });
      }
      parentId = id;
    });
  });
  return { root, readChildren: async (id) => {
    const entries = children.get(id);
    if (!entries) throw new Error("압축 파일 안의 폴더를 찾을 수 없습니다.");
    return entries;
  } };
}
