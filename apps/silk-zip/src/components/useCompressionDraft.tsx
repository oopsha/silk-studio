import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ResourceTree from "@silk-studio/workbench/components/explorer/ResourceTree.tsx";
import type { ResourceSource } from "@silk-studio/workbench/components/explorer/resourceExplorerTypes.ts";

type DraftEntry = { sourcePath: string | null; archivePath: string; directory: boolean; size: number | null };
const parentOf = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const basename = (path: string) => path.split("/").pop() ?? path;
const sizeLabel = (size: number | null) => {
  if (size === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} ${units[unit]}`;
};

export function useCompressionDraft(rootName: string) {
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [current, setCurrent] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const anchor = useRef(0);
  const drag = useRef<{ anchor: number; base: Set<string> } | null>(null);
  const revision = useRef(0);
  const dropHighlight = useRef<HTMLElement | null>(null);
  const clearDropTarget = useCallback(() => {
    dropHighlight.current?.classList.remove("zip-draft-drop-target");
    dropHighlight.current = null;
  }, []);
  const resolveDropTarget = useCallback((position: { x: number; y: number }) => {
    // Tauri reports physical webview coordinates; DOM hit testing uses CSS pixels.
    const scale = window.devicePixelRatio || 1;
    const element = document.elementFromPoint(position.x / scale, position.y / scale);
    const row = element?.closest<HTMLElement>("[data-zip-draft-folder], [data-zip-draft-tree] [data-resource-id]") ?? null;
    const path = row?.getAttribute("data-zip-draft-folder") ?? row?.getAttribute("data-resource-id");
    const valid = path !== null && path !== undefined && (path === "" || entries.some((entry) => entry.directory && entry.archivePath === path));
    if (dropHighlight.current !== (valid ? row : null)) {
      clearDropTarget();
      if (valid && row) { row.classList.add("zip-draft-drop-target"); dropHighlight.current = row; }
    }
    return valid ? path : current;
  }, [current, entries, clearDropTarget]);
  const visible = useMemo(() => entries.filter((entry) => parentOf(entry.archivePath) === current).sort((a, b) => Number(b.directory) - Number(a.directory) || basename(a.archivePath).localeCompare(basename(b.archivePath), undefined, { numeric: true })), [entries, current]);
  const source = useMemo<ResourceSource>(() => ({
    root: { id: "", name: rootName, directory: true },
    readChildren: async (id) => entries.filter((entry) => parentOf(entry.archivePath) === id).map((entry) => ({ id: entry.archivePath, name: basename(entry.archivePath), directory: entry.directory, size: entry.size })),
  }), [entries, rootName]);
  const navigate = (path: string) => { setCurrent(path); setSelected(new Set()); setNewFolder(null); };
  const add = useCallback(async (paths: string[], target = current) => {
    if (!paths.length) return;
    const version = revision.current;
    setPending(true); setError("");
    try {
      const scanned = await invoke<[string, string, number | null, boolean][]>("draft_scan", { paths });
      if (version !== revision.current) return;
      const additions = scanned.map(([sourcePath, name, size, directory]) => ({ sourcePath, archivePath: target ? `${target}/${name}` : name, size, directory }));
      setEntries((existing) => {
        if (target && !existing.some((entry) => entry.archivePath === target && entry.directory)) return existing;
        const merged = [...existing];
        for (const entry of additions) {
          const conflict = merged.find((other) => other.archivePath.toLocaleLowerCase() === entry.archivePath.toLocaleLowerCase());
          if (conflict && conflict.sourcePath !== entry.sourcePath) { setError(`같은 이름의 항목이 있습니다: ${entry.archivePath}`); return existing; }
          if (!conflict) merged.push(entry);
        }
        return merged;
      });
    } catch (reason) { if (version === revision.current) setError(String(reason)); }
    finally { setPending(false); }
  }, [current]);
  const remove = () => {
    setEntries((items) => items.filter((entry) => ![...selected].some((path) => entry.archivePath === path || entry.archivePath.startsWith(`${path}/`))));
    setSelected(new Set());
  };
  const reset = () => { revision.current += 1; setEntries([]); navigate(""); setError(""); };
  const createFolder = () => {
    const name = newFolder?.trim() ?? "";
    if (!name || /[\\/:*?"<>|]/.test(name) || name === "." || name === ".." || /[. ]$/.test(name)) { setError("올바른 폴더 이름을 입력하세요."); return; }
    const path = current ? `${current}/${name}` : name;
    if (entries.some((entry) => entry.archivePath.toLocaleLowerCase() === path.toLocaleLowerCase())) { setError("같은 이름의 항목이 있습니다."); return; }
    setEntries((items) => [...items, { archivePath: path, sourcePath: null, directory: true, size: null }]);
    setNewFolder(null); setError(""); setSelected(new Set([path]));
  };
  const list = <>
    {entries.length > 0 ? <nav className="zip-draft-path" aria-label="압축 내부 경로"><button onClick={() => navigate("")}>{rootName}</button>{current.split("/").filter(Boolean).map((part, index, parts) => <span key={index}> › <button onClick={() => navigate(parts.slice(0, index + 1).join("/"))}>{part}</button></span>)}</nav> : null}
    {newFolder !== null ? <form className="zip-draft-folder" onSubmit={(event) => { event.preventDefault(); createFolder(); }}><input autoFocus aria-label="새 폴더 이름" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setNewFolder(null); }} /><button className="zip-button" type="submit">만들기</button><button className="zip-button" type="button" onClick={() => setNewFolder(null)}>취소</button></form> : null}
    {error ? <p role="alert">{error}</p> : null}
    {pending ? <p role="status">추가할 파일과 폴더를 읽고 있습니다…</p> : null}
    <div className="zip-file-table"><div className="zip-file-header" aria-hidden="true"><span /><span>이름</span><span>파일 크기</span><span>경로</span></div><div className="zip-file-list" role="listbox" aria-label="압축할 파일 목록" aria-multiselectable="true" onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }} onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); setSelected(new Set(visible.map((entry) => entry.archivePath))); }
      if (event.key === "Delete") { event.preventDefault(); remove(); }
    }}>
      {current ? <div className="zip-file" data-zip-draft-folder={parentOf(current)} tabIndex={0} onDoubleClick={() => navigate(parentOf(current))} onKeyDown={(event) => { if (event.key === "Enter") navigate(parentOf(current)); }}><span className="codicon codicon-folder" /><span>..</span></div> : null}
      {visible.map((entry, index) => <div className={`zip-file${selected.has(entry.archivePath) ? " zip-file--selected" : ""}`} key={entry.archivePath} data-zip-draft-folder={entry.directory ? entry.archivePath : undefined} tabIndex={0} role="option" aria-selected={selected.has(entry.archivePath)} onDoubleClick={() => { if (entry.directory) navigate(entry.archivePath); }} onKeyDown={(event) => { if (event.key === "Enter" && entry.directory) navigate(entry.archivePath); else if (event.key === " ") { event.preventDefault(); setSelected(new Set([entry.archivePath])); } }} onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus();
        const additive = event.ctrlKey || event.metaKey;
        const from = event.shiftKey ? anchor.current : index;
        const base = additive ? new Set(selected) : new Set<string>();
        const next = new Set(base);
        if (event.shiftKey) { for (let i = Math.min(from, index); i <= Math.max(from, index); i++) next.add(visible[i].archivePath); }
        else if (additive && next.has(entry.archivePath)) next.delete(entry.archivePath);
        else next.add(entry.archivePath);
        if (!event.shiftKey) anchor.current = index;
        drag.current = { anchor: from, base }; setSelected(next);
      }} onMouseEnter={(event) => {
        if (!drag.current || event.buttons !== 1) return;
        const next = new Set(drag.current.base);
        for (let i = Math.min(drag.current.anchor, index); i <= Math.max(drag.current.anchor, index); i++) next.add(visible[i].archivePath);
        setSelected(next);
      }}><span className={`codicon ${entry.directory ? "codicon-folder" : "codicon-file"}`} /><span className="zip-file__name" title={basename(entry.archivePath)}>{basename(entry.archivePath)}</span><span className="zip-file__size">{entry.directory ? "폴더" : sizeLabel(entry.size)}</span><span className="zip-file__path" title={entry.sourcePath ?? "압축 내부 폴더"}>{entry.sourcePath ?? "압축 내부 폴더"}</span></div>)}
      {!visible.length ? <div className="zip-draft-empty"><strong>파일이나 폴더를 여기로 끌어오세요</strong><span>또는 추가를 눌러 선택</span></div> : null}
    </div></div>
  </>;
  return { entries, add, resolveDropTarget, clearDropTarget, remove, reset, pending, selectedCount: selected.size, newFolder: () => setNewFolder("새 폴더"), list, tree: <div data-zip-draft-tree><ResourceTree source={source} selectedId={current} directoriesOnly expandedPath={["", ...current.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"))]} onSelect={(node) => navigate(node.id)} /></div> };
}
