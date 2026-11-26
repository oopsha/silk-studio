/** A hover button on every row; `onRowMenu` also receives right-clicks on rows. */
export type ResourceRowAction = { icon: string; title: string };
export type RowMenuHandler = (nodes: readonly ResourceNode[], anchor: { x: number; y: number }) => void;

export type ResourceNode = {
  id: string;
  name: string;
  directory: boolean;
  size?: number | null;
  encrypted?: boolean;
  /** Where the item comes from (e.g. the source file of an entry that is about to be added). */
  location?: string;
  /** Extra values an app shows in its own columns (compressed size, modified time, ...). */
  meta?: Record<string, string | number | undefined>;
  /** Short note shown by apps in a status column (e.g. a pending change). */
  status?: string;
  /** Overrides the icon chosen from the name (e.g. an archive shown as a folder). */
  icon?: ResourceIcon;
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

/** A codicon, or (with `label`) a small coloured badge such as "ZIP" or "7Z". */
export type ResourceIcon = { name: string; className: string; label?: string; color?: string };

const ARCHIVE_ICON: ResourceIcon = { name: "file-zip", className: "resource-icon--archive" };
/** Each archive format gets its own badge, grouped by colour. */
const ARCHIVE_BADGES: Record<string, [string, string]> = {
  zip: ["ZIP", "#d9a21b"], jar: ["JAR", "#d9a21b"], war: ["WAR", "#d9a21b"],
  "7z": ["7Z", "#3fa66a"],
  rar: ["RAR", "#a05cc7"],
  tar: ["TAR", "#4a8fe0"], gz: ["GZ", "#4a8fe0"], tgz: ["TGZ", "#4a8fe0"], bz2: ["BZ2", "#4a8fe0"], tbz: ["TBZ", "#4a8fe0"],
  xz: ["XZ", "#4a8fe0"], txz: ["TXZ", "#4a8fe0"], lzma: ["LZMA", "#4a8fe0"], zst: ["ZST", "#4a8fe0"],
  iso: ["ISO", "#8a8f98"], cab: ["CAB", "#8a8f98"], arj: ["ARJ", "#8a8f98"], lzh: ["LZH", "#8a8f98"], lha: ["LHA", "#8a8f98"],
};

/** Icons by file extension; anything not listed gets the plain file icon. */
const EXTENSION_ICONS = new Map<string, ResourceIcon>();
const addIcons = (extensions: string, icon: ResourceIcon) => extensions.split(" ").forEach((extension) => EXTENSION_ICONS.set(extension, icon));
for (const [extension, [label, color]] of Object.entries(ARCHIVE_BADGES)) EXTENSION_ICONS.set(extension, { ...ARCHIVE_ICON, label, color });
addIcons("png jpg jpeg gif webp svg ico bmp tif tiff heic", { name: "file-media", className: "resource-icon--media" });
addIcons("mp3 wav flac ogg aac m4a wma mid", { name: "unmute", className: "resource-icon--audio" });
addIcons("mp4 mkv avi mov wmv webm flv m4v", { name: "play-circle", className: "resource-icon--video" });
addIcons("pdf", { name: "file-pdf", className: "resource-icon--pdf" });
addIcons("doc docx rtf odt hwp hwpx", { name: "file-text", className: "resource-icon--word" });
addIcons("xls xlsx xlsm csv ods", { name: "table", className: "resource-icon--excel" });
addIcons("ppt pptx odp", { name: "graph", className: "resource-icon--ppt" });
addIcons("html htm xhtml xml css scss less js jsx mjs ts tsx java rs py cs vb go c cpp h hpp php asp aspx ascx ashx asax jsp cshtml razor rb kt swift lua", { name: "file-code", className: "resource-icon--code" });
addIcons("json yaml yml", { name: "json", className: "resource-icon--data" });
addIcons("sql db mdb accdb sqlite sqlite3", { name: "database", className: "resource-icon--data" });
addIcons("config ini conf cfg properties toml env", { name: "settings-gear", className: "resource-icon--config" });
addIcons("exe msi com", { name: "window", className: "resource-icon--exe" });
addIcons("bat cmd sh ps1 psm1", { name: "terminal", className: "resource-icon--exe" });
addIcons("dll so dylib lib ocx sys", { name: "library", className: "resource-icon--binary" });
addIcons("bin dat obj pdb class o", { name: "file-binary", className: "resource-icon--binary" });
addIcons("md markdown", { name: "markdown", className: "resource-icon--text" });
addIcons("txt log", { name: "file-text", className: "resource-icon--text" });

const PLAIN_FILE: ResourceIcon = { name: "file", className: "resource-icon--text" };

export function resourceIcon(node: ResourceNode): ResourceIcon {
  if (node.icon) return node.icon;
  if (node.directory) return { name: "folder", className: "resource-icon--folder" };
  const dot = node.name.lastIndexOf(".");
  // Names such as ".gitignore" or ".env" are settings files.
  if (dot === 0) return { name: "settings-gear", className: "resource-icon--config" };
  const extension = dot > 0 ? node.name.slice(dot + 1).toLowerCase() : "";
  return EXTENSION_ICONS.get(extension) ?? PLAIN_FILE;
}
