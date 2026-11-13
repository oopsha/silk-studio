import { describe, expect, it } from "vitest";
import { createArchiveSource } from "./archiveSource";
import type { ArchiveListing } from "./archive";

function source(entries: ArchiveListing["entries"]) {
  return createArchiveSource({ path: "C:\\archives\\sample.zip", format: "ZIP", engine: "libarchive", warnings: [], entries });
}

describe("archive resource source", () => {
  it("creates implicit folders and returns only immediate children", async () => {
    const tree = source([
      { path: "client-drop/config/app.xml", directory: false, size: 7, encrypted: false },
      { path: "deploy.txt", directory: false, size: 3, encrypted: true },
      { path: "client-drop/", directory: true, size: 0, encrypted: false },
    ]);
    const root = await tree.readChildren(tree.root.id);
    expect(root.map((node) => node.name)).toEqual(["client-drop", "deploy.txt"]);
    const folder = await tree.readChildren(root[0].id);
    expect(folder.map((node) => node.name)).toEqual(["config"]);
    const files = await tree.readChildren(folder[0].id);
    expect(files[0]).toMatchObject({ name: "app.xml", size: 7, directory: false });
    expect(root[1].encrypted).toBe(true);
  });

  it("preserves duplicate file entries with independent IDs", async () => {
    const entry = { path: "same.txt", directory: false, size: 0, encrypted: false };
    const tree = source([entry, entry]);
    const nodes = await tree.readChildren(tree.root.id);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].id).not.toBe(nodes[1].id);
  });

  it("handles empty archives, unicode and Windows separators", async () => {
    const empty = source([]);
    expect(await empty.readChildren(empty.root.id)).toEqual([]);
    const tree = source([{ path: "폴더\\파일.txt", directory: false, size: 5, encrypted: false }]);
    const nodes = await tree.readChildren(tree.root.id);
    expect(nodes[0].name).toBe("폴더");
    expect((await tree.readChildren(nodes[0].id))[0].name).toBe("파일.txt");
    await expect(tree.readChildren("not-a-directory")).rejects.toThrow();
  });

  it("keeps traversal-like archive names as virtual nodes without resolving paths", async () => {
    const tree = source([{ path: "../outside.txt", directory: false, size: 1, encrypted: false }]);
    const nodes = await tree.readChildren(tree.root.id);
    expect(nodes[0].name).toBe("..");
    expect(nodes[0].id).toBe('directory:[".."]');
  });
});
