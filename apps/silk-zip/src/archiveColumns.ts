import type { ResourceColumn } from "@silk-studio/workbench/components/explorer/ResourceExplorer.tsx";
import type { ResourceNode } from "@silk-studio/workbench/components/explorer/resourceExplorerTypes.ts";
import type { ZipColumnId } from "./zipSettings";

const bytes = (size: number) => `${size.toLocaleString()} B`;

function formatDate(seconds: number): string {
  const date = new Date(seconds * 1000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** "PNG 파일", "폴더", or just "파일" for a name without extension. */
export function kindLabel(node: ResourceNode): string {
  if (node.directory) return "폴더";
  const dot = node.name.lastIndexOf(".");
  return dot > 0 && dot < node.name.length - 1 ? `${node.name.slice(dot + 1).toUpperCase()} 파일` : "파일";
}

/** Unix mode (high 16 bits, flagged by 0x8000) as "rwxr-xr-x"; otherwise the Windows flags R, H, S, A. */
export function formatAttributes(attributes: number): string {
  if (attributes & 0x8000) {
    const mode = attributes >>> 16;
    return [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001].map((bit, index) => (mode & bit ? "rwx"[index % 3] : "-")).join("");
  }
  return [[0x1, "R"], [0x2, "H"], [0x4, "S"], [0x20, "A"]].map(([bit, letter]) => (attributes & (bit as number) ? letter : "")).join("");
}

const meta = (node: ResourceNode, key: string) => node.meta?.[key];

/** How each selectable column shows an item; items without the value show nothing. */
const RENDERERS: Record<ZipColumnId, (node: ResourceNode) => string> = {
  packed: (node) => { const value = meta(node, "packedSize"); return typeof value === "number" && !node.directory ? bytes(value) : ""; },
  size: (node) => (node.directory || node.size == null ? "—" : bytes(node.size)),
  kind: kindLabel,
  modified: (node) => { const value = meta(node, "modified"); return typeof value === "number" ? formatDate(value) : ""; },
  method: (node) => String(meta(node, "method") ?? ""),
  encryption: (node) => String(meta(node, "encryption") ?? (node.encrypted ? "예" : "")),
  crc: (node) => { const value = meta(node, "crc"); return typeof value === "number" && !node.directory ? value.toString(16).toUpperCase().padStart(8, "0") : ""; },
  attributes: (node) => { const value = meta(node, "attributes"); return typeof value === "number" ? formatAttributes(value) : ""; },
};

const TITLES: Record<ZipColumnId, string> = { packed: "압축 크기", size: "원본 크기", kind: "파일 종류", modified: "수정한 날짜", method: "압축 방식", encryption: "암호 방식", crc: "CRC", attributes: "속성" };
const RIGHT_ALIGNED = new Set<ZipColumnId>(["packed", "size"]);

export function zipColumn(id: ZipColumnId): ResourceColumn {
  return { id, title: TITLES[id], render: RENDERERS[id], align: RIGHT_ALIGNED.has(id) ? "right" : undefined };
}

/** Columns of an opened archive: the ones chosen in 보기 > 표시할 열. */
export function archiveColumns(visible: readonly ZipColumnId[]): readonly ResourceColumn[] {
  return visible.map(zipColumn);
}

/** Marks of pending changes, shown only while changes wait to be applied. */
export const STATUS_ICONS = {
  "추가됨": { name: "add", className: "zip-status-icon--added" },
  "이름 변경됨": { name: "edit", className: "zip-status-icon--renamed" },
} as const;

/** Columns of a new archive: where each file comes from instead of archive details. */
export const draftColumns: readonly ResourceColumn[] = [
  zipColumn("kind"),
  zipColumn("size"),
  { id: "location", title: "경로", render: (node) => node.location ?? "" },
];
