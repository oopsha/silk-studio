import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { languageIdFromPath } from "@silk-studio/editor/services/editor/languageFromPath.ts";

type Entry = { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean };
type CreateRequest = {
  parentPath: string;
  projectName: string;
  buildTool: "maven" | "gradle";
  groupId: string;
  artifactId: string;
  packageName: string;
  javaVersion: string;
  dependencies: string[];
};

const STORAGE_KEY = "silk.be.projectRoot";
const HIDDEN_DIRS = new Set([".git", ".gradle", "build", "node_modules", "target"]);
const DEPENDENCIES = [
  ["web", "Spring Web"],
  ["data-jpa", "Spring Data JPA"],
  ["security", "Spring Security"],
  ["validation", "Validation"],
  ["lombok", "Lombok"],
  ["devtools", "Spring Boot DevTools"],
  ["h2", "H2 Database"],
  ["mysql", "MySQL Driver"],
  ["postgresql", "PostgreSQL Driver"],
] as const;

function joinPath(parent: string, child: string) {
  return `${parent.replace(/[\\/]$/, "")}${parent.includes("\\") ? "\\" : "/"}${child}`;
}

function ProjectTree({ root, path, depth = 0 }: { root: string; path: string; depth?: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [expanded, setExpanded] = useState(depth === 0);
  const [error, setError] = useState("");
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || path;

  async function loadDirectory() {
    try {
      const items = await readDir(path);
      setEntries(items
        .filter((entry) => !(entry.isDirectory && HIDDEN_DIRS.has(entry.name)))
        .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name)));
      setError("");
    } catch (cause) {
      setError(String(cause));
    }
  }

  useEffect(() => {
    if (expanded && !entries) void loadDirectory();
  }, [expanded]);

  async function toggleDirectory() {
    if (expanded) {
      setExpanded(false);
    } else {
      if (!entries) await loadDirectory();
      setExpanded(true);
    }
  }

  async function openFile(filePath = path, fileName = name) {
    try {
      const content = await readTextFile(filePath);
      const extension = fileName.split(".").at(-1)?.toLowerCase();
      EditorService.openEditor({
        uri: filePath,
        label: fileName,
        languageId: extension === "java" ? "java" : languageIdFromPath(filePath),
        content,
      });
    } catch (cause) {
      setError(String(cause));
    }
  }

  const isDirectory = depth === 0 || Boolean(entries) || path.endsWith("/") || path.endsWith("\\");
  return <>
    <button
      className="be-project-tree__row"
      style={{ paddingLeft: 12 + depth * 14 }}
      onClick={() => isDirectory ? void toggleDirectory() : void openFile()}
      title={error || path}
    >
      <span className="be-project-tree__icon">{isDirectory ? (expanded ? "▾" : "▸") : ""}</span>
      <span>{isDirectory ? "▰" : "▱"}</span>
      <span className="be-project-tree__name">{name}</span>
    </button>
    {error ? <div className="be-project-tree__error">{error}</div> : null}
    {expanded ? (entries ?? []).map((entry) => {
      const childPath = joinPath(path, entry.name);
      return entry.isDirectory
        ? <ProjectTree key={childPath} root={root} path={`${childPath}${path.includes("\\") ? "\\" : "/"}`} depth={depth + 1} />
        : <button key={childPath} className="be-project-tree__row" style={{ paddingLeft: 12 + (depth + 1) * 14 }} onClick={() => void openFile(childPath, entry.name)} title={childPath}>
          <span className="be-project-tree__icon" />
          <span>▱</span>
          <span className="be-project-tree__name">{entry.name}</span>
        </button>;
    }) : null}
  </>;
}

function SpringProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (root: string) => void }) {
  const [name, setName] = useState("demo");
  const [groupId, setGroupId] = useState("com.example");
  const [buildTool, setBuildTool] = useState<"maven" | "gradle">("gradle");
  const [javaVersion, setJavaVersion] = useState("21");
  const [dependencies, setDependencies] = useState<string[]>(["web"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!isTauri()) { setError("프로젝트 생성은 데스크톱 앱에서 사용할 수 있습니다."); return; }
    const parentPath = await open({ directory: true, multiple: false, title: "프로젝트를 저장할 상위 폴더 선택" });
    if (!parentPath || Array.isArray(parentPath)) return;
    const artifactId = name.trim();
    const packageName = `${groupId.trim()}.${artifactId.replace(/[^A-Za-z0-9_]/g, "_")}`;
    setBusy(true);
    setError("");
    try {
      const request: CreateRequest = { parentPath, projectName: artifactId, buildTool, groupId: groupId.trim(), artifactId, packageName, javaVersion, dependencies };
      const root = await invoke<string>("create_spring_project", { request });
      onCreated(root);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return <div className="be-project-dialog__backdrop" role="presentation">
    <section className="be-project-dialog" role="dialog" aria-modal="true" aria-labelledby="be-project-dialog-title">
      <header><strong id="be-project-dialog-title">새 Spring Boot 프로젝트</strong><button onClick={onClose} aria-label="닫기">×</button></header>
      <label>프로젝트 이름<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Group<input value={groupId} onChange={(event) => setGroupId(event.target.value)} /></label>
      <div className="be-project-dialog__split">
        <label>빌드 도구<select value={buildTool} onChange={(event) => setBuildTool(event.target.value as "maven" | "gradle")}><option value="gradle">Gradle</option><option value="maven">Maven</option></select></label>
        <label>Java<select value={javaVersion} onChange={(event) => setJavaVersion(event.target.value)}><option>17</option><option>21</option><option>25</option></select></label>
      </div>
      <fieldset><legend>Dependencies</legend><div className="be-project-dialog__dependencies">
        {DEPENDENCIES.map(([id, label]) => <label key={id}><input type="checkbox" checked={dependencies.includes(id)} onChange={(event) => setDependencies((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{label}</label>)}
      </div></fieldset>
      {error ? <div className="be-project-dialog__error">{error}</div> : null}
      <footer><button onClick={onClose} disabled={busy}>취소</button><button className="primary" onClick={() => void create()} disabled={busy || !name.trim() || !groupId.trim()}>{busy ? "생성 중…" : "생성"}</button></footer>
    </section>
  </div>;
}

export default function ProjectExplorer() {
  const [root, setRoot] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (root) void readDir(root).catch((cause) => setError(`저장된 프로젝트 폴더를 열지 못했습니다: ${String(cause)}`));
  }, []);

  function setProjectRoot(path: string) {
    setRoot(path);
    localStorage.setItem(STORAGE_KEY, path);
    setError("");
  }

  async function openProject() {
    if (!isTauri()) { setError("프로젝트 폴더 열기는 데스크톱 앱에서 사용할 수 있습니다."); return; }
    const selected = await open({ directory: true, multiple: false, title: "프로젝트 폴더 열기" });
    if (!selected || Array.isArray(selected)) return;
    setProjectRoot(selected);
  }

  return <div className="be-project-explorer">
    <div className="be-project-explorer__actions">
      <button onClick={() => void openProject()}>폴더 열기</button>
      <button onClick={() => setShowCreate(true)}>새 Spring 프로젝트</button>
    </div>
    {error ? <div className="be-project-tree__error">{error}</div> : null}
    {root ? <div className="be-project-tree"><ProjectTree key={root} root={root} path={root} /></div> : <div className="be-project-empty">프로젝트 폴더를 열거나 새 Spring 프로젝트를 만드세요.</div>}
    {showCreate ? <SpringProjectDialog onClose={() => setShowCreate(false)} onCreated={(path) => { setProjectRoot(path); setShowCreate(false); }} /> : null}
  </div>;
}
