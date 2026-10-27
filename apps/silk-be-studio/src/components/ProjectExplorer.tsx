import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { languageIdFromPath } from "@silk-studio/editor/services/editor/languageFromPath.ts";

type Entry = { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean };
type CreateRequest = {
  source: "online" | "offline";
  parentPath: string;
  projectName: string;
  buildTool: "maven" | "gradle";
  typeId: string;
  groupId: string;
  artifactId: string;
  packageName: string;
  javaVersion: string;
  bootVersion: string;
  language: string;
  packaging: string;
  configurationFileFormat: string;
  dependencies: string[];
};
type CreateResult = { path: string; source: "initializr" | "offline" };
type InitializrOption = { id: string; name: string; tags?: Record<string, string> };
type DependencyGroup = { name: string; values: InitializrOption[] };
type InitializrFormMetadata = {
  updatedAt: string;
  defaults: Record<string, string>;
  types: InitializrOption[];
  bootVersions: InitializrOption[];
  javaVersions: InitializrOption[];
  languages: InitializrOption[];
  packagings: InitializrOption[];
  configurationFileFormats: InitializrOption[];
  dependencies: DependencyGroup[];
};

const STORAGE_KEY = "silk.be.projectRoot";
const HIDDEN_DIRS = new Set([".git", ".gradle", "build", "node_modules", "target"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readInitializrOptionSet(raw: Record<string, unknown>): { defaults: Record<string, string>; options: Record<string, InitializrOption[]>; dependencies: DependencyGroup[] } {
  const defaults: Record<string, string> = {};
  const options: Record<string, InitializrOption[]> = {};
  for (const key of ["type", "bootVersion", "javaVersion", "language", "packaging", "configurationFileFormat"]) {
    const field = asRecord(raw[key]);
    if (typeof field.default === "string") defaults[key] = field.default;
    options[key] = (Array.isArray(field.values) ? field.values : []).map((item) => {
      const value = asRecord(item);
      return { id: String(value.id ?? ""), name: String(value.name ?? ""), tags: asRecord(value.tags) as Record<string, string> };
    }).filter((value) => value.id && value.name);
  }
  const dependencyMetadata = asRecord(raw.dependencies);
  const dependencyGroups = (Array.isArray(dependencyMetadata.values) ? dependencyMetadata.values : []).map((item) => {
    const group = asRecord(item);
    const values = (Array.isArray(group.values) ? group.values : []).map((dependency) => {
      const value = asRecord(dependency);
      return { id: String(value.id ?? ""), name: String(value.name ?? "") };
    }).filter((value) => value.id && value.name);
    return { name: String(group.name ?? ""), values };
  }).filter((group) => group.values.length);
  return { defaults, options, dependencies: dependencyGroups };
}

function joinPath(parent: string, child: string) {
  return `${parent.replace(/[\\/]$/, "")}${parent.includes("\\") ? "\\" : "/"}${child}`;
}

function ProjectTree({ root, path, depth = 0 }: { root: string; path: string; depth?: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [expanded, setExpanded] = useState(depth === 0);
  const [error, setError] = useState("");
  const pathSegments = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  const name = pathSegments[pathSegments.length - 1] || path;

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
      const fileNameSegments = fileName.split(".");
      const extension = fileNameSegments[fileNameSegments.length - 1]?.toLowerCase();
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

function SpringProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (result: CreateResult) => void }) {
  const [source, setSource] = useState<"online" | "offline">("online");
  const [name, setName] = useState("demo");
  const [groupId, setGroupId] = useState("com.example");
  const [artifactId, setArtifactId] = useState("demo");
  const [packageName, setPackageName] = useState("com.example.demo");
  const [metadata, setMetadata] = useState<InitializrFormMetadata>({
    updatedAt: "", defaults: {}, types: [], bootVersions: [], javaVersions: [], languages: [], packagings: [], configurationFileFormats: [], dependencies: [],
  });
  const [typeId, setTypeId] = useState("");
  const [bootVersion, setBootVersion] = useState("");
  const [javaVersion, setJavaVersion] = useState("");
  const [language, setLanguage] = useState("java");
  const [packaging, setPackaging] = useState("jar");
  const [configurationFileFormat, setConfigurationFileFormat] = useState("properties");
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [dependencySearch, setDependencySearch] = useState("");
  const [expandedDependencyGroups, setExpandedDependencyGroups] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void invoke<Record<string, unknown>>("get_spring_initializr_metadata", { source, bootVersion: null }).then((raw) => {
      if (!active) return;
      const parsed = readInitializrOptionSet(asRecord(raw.capabilities));
      const projectTypes = parsed.options.type.filter((option) => option.tags?.format === "project" || option.id.endsWith("-project"));
      if (!projectTypes.length || !parsed.options.javaVersion?.length) throw new Error("Spring Initializr 메타데이터 형식이 올바르지 않습니다.");
      setMetadata({
        updatedAt: typeof raw.fetchedAt === "string" ? raw.fetchedAt.slice(0, 10) : "",
        defaults: parsed.defaults,
        types: projectTypes,
        bootVersions: parsed.options.bootVersion,
        javaVersions: parsed.options.javaVersion,
        languages: parsed.options.language,
        packagings: parsed.options.packaging,
        configurationFileFormats: parsed.options.configurationFileFormat,
        dependencies: parsed.dependencies,
      });
      setTypeId(projectTypes.some((option) => option.id === parsed.defaults.type) ? parsed.defaults.type : projectTypes[0].id);
      setBootVersion(parsed.defaults.bootVersion ?? parsed.options.bootVersion[0]?.id ?? "");
      setJavaVersion(parsed.defaults.javaVersion ?? parsed.options.javaVersion[0].id);
      setLanguage(parsed.defaults.language ?? "java");
      setPackaging(parsed.defaults.packaging ?? "jar");
      setConfigurationFileFormat(parsed.defaults.configurationFileFormat ?? "properties");
      setDependencies([]);
    }).catch((cause) => {
      if (active) setError(`${source === "online" ? "온라인 Spring Initializr" : "저장소의 오프라인"} 메타데이터를 읽지 못했습니다: ${String(cause)}`);
    }).finally(() => { if (active) setMetadataLoading(false); });
    return () => { active = false; };
  }, [source]);

  useEffect(() => {
    if (metadataLoading || !bootVersion) return;
    let active = true;
    void invoke<Record<string, unknown>>("get_spring_initializr_metadata", { source, bootVersion }).then((raw) => {
      if (!active) return;
      const parsed = readInitializrOptionSet(asRecord(raw.capabilities));
      setMetadata((current) => ({ ...current, dependencies: parsed.dependencies }));
      setDependencies((current) => current.filter((id) => parsed.dependencies.some((group) => group.values.some((dependency) => dependency.id === id))));
    }).catch((cause) => { if (active) setError(`${source === "online" ? "온라인" : "오프라인"} 의존성 목록을 읽지 못했습니다: ${String(cause)}`); });
    return () => { active = false; };
  }, [source, bootVersion, metadataLoading]);

  const buildTool = typeId.toLowerCase().startsWith("maven") ? "maven" : "gradle";

  async function create() {
    if (!isTauri()) { setError("프로젝트 생성은 데스크톱 앱에서 사용할 수 있습니다."); return; }
    const parentPath = await open({ directory: true, multiple: false, title: "프로젝트를 저장할 상위 폴더 선택" });
    if (!parentPath || Array.isArray(parentPath)) return;
    const cleanArtifactId = artifactId.trim();
    setBusy(true);
    setError("");
    try {
      const request: CreateRequest = { source, parentPath, projectName: name.trim(), buildTool, typeId, groupId: groupId.trim(), artifactId: cleanArtifactId, packageName: packageName.trim(), javaVersion, bootVersion, language, packaging, configurationFileFormat, dependencies };
      const result = await invoke<CreateResult>("create_spring_project", { request });
      onCreated(result);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return <div className="be-project-dialog__backdrop" role="presentation">
    <section className="be-project-dialog" role="dialog" aria-modal="true" aria-labelledby="be-project-dialog-title">
      <header><strong id="be-project-dialog-title">새 Spring Boot 프로젝트</strong><button onClick={onClose} aria-label="닫기">×</button></header>
      <label>생성 방식<select value={source} onChange={(event) => { setMetadataLoading(true); setError(""); setSource(event.target.value as "online" | "offline"); }}><option value="offline">오프라인 템플릿 (저장소 포함)</option><option value="online">온라인 Spring Initializr</option></select></label>
      <label>프로젝트 이름<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Group<input value={groupId} onChange={(event) => setGroupId(event.target.value)} /></label>
      <label>Artifact<input value={artifactId} onChange={(event) => setArtifactId(event.target.value)} /></label>
      <label>Package name<input value={packageName} onChange={(event) => setPackageName(event.target.value)} /></label>
      <div className="be-project-dialog__split">
        <label>프로젝트 형식<select value={typeId} onChange={(event) => setTypeId(event.target.value)}>{metadata.types.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
        <label>Spring Boot<select value={bootVersion} onChange={(event) => setBootVersion(event.target.value)}>{metadata.bootVersions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      </div>
      <div className="be-project-dialog__split">
        <label>언어<select value={language} onChange={(event) => setLanguage(event.target.value)}>{metadata.languages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
        <label>Java 버전<select value={javaVersion} onChange={(event) => setJavaVersion(event.target.value)}>{metadata.javaVersions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      </div>
      <div className="be-project-dialog__split">
        <label>패키징<select value={packaging} onChange={(event) => setPackaging(event.target.value)}>{metadata.packagings.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
        <label>설정 파일<select value={configurationFileFormat} onChange={(event) => setConfigurationFileFormat(event.target.value)}>{metadata.configurationFileFormats.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      </div>
      <fieldset><legend>Dependencies</legend>
        <div className="be-project-dialog__dependency-toolbar">
          <input aria-label="의존성 검색" placeholder="의존성 검색" value={dependencySearch} onChange={(event) => setDependencySearch(event.target.value)} />
          <span>{dependencies.length}개 선택</span>
        </div>
        {dependencies.length > 0 ? <div className="be-project-dialog__selected-dependencies" aria-label="선택한 의존성">
          {dependencies.map((id) => {
            const label = metadata.dependencies.flatMap((group) => group.values).find((dependency) => dependency.id === id)?.name ?? id;
            return <button type="button" key={id} title={`${label} 선택 해제`} onClick={() => setDependencies((current) => current.filter((item) => item !== id))}>{label}<span aria-hidden="true"> ×</span></button>;
          })}
        </div> : null}
        <div className="be-project-dialog__dependencies">
        {metadata.dependencies.map((group) => {
          const items = group.values.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(dependencySearch.toLowerCase()));
          return items.length ? <details key={group.name} open={Boolean(dependencySearch.trim()) || expandedDependencyGroups.includes(group.name)} onToggle={(event) => {
            const isOpen = event.currentTarget.open;
            setExpandedDependencyGroups((current) => isOpen
              ? current.includes(group.name) ? current : [...current, group.name]
              : current.filter((name) => name !== group.name));
          }}>
            <summary>{group.name}<span>{items.length}</span></summary>
            <div className="be-project-dialog__dependency-options">{items.map(({ id, name: label }) => <label key={id}><input type="checkbox" checked={dependencies.includes(id)} onChange={(event) => setDependencies((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{label}</label>)}</div>
          </details> : null;
        })}
      </div></fieldset>
      <div className="be-project-dialog__metadata-status">{metadataLoading ? `${source === "online" ? "Spring Initializr" : "저장된 Spring Initializr 선택지"} 불러오는 중…` : source === "online" ? "온라인 Spring Initializr 메타데이터" : `릴리즈 포함 오프라인 메타데이터 · ${metadata.updatedAt} 기준`}</div>
      {error ? <div className="be-project-dialog__error">{error}</div> : null}
      <footer><button onClick={onClose} disabled={busy}>취소</button><button className="primary" onClick={() => void create()} disabled={busy || !name.trim() || !groupId.trim() || !artifactId.trim() || !packageName.trim() || metadataLoading || !metadata.types.length}>{busy ? "생성 중…" : "생성"}</button></footer>
    </section>
  </div>;
}

export default function ProjectExplorer() {
  const [root, setRoot] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    {notice ? <div className="be-project-empty">{notice}</div> : null}
    {root ? <div className="be-project-tree"><ProjectTree key={root} root={root} path={root} /></div> : <div className="be-project-empty">프로젝트 폴더를 열거나 새 Spring 프로젝트를 만드세요.</div>}
    {showCreate ? <SpringProjectDialog onClose={() => setShowCreate(false)} onCreated={(result) => { setProjectRoot(result.path); setShowCreate(false); setNotice(result.source === "offline" ? "오프라인 템플릿으로 프로젝트를 생성했습니다." : "Spring Initializr에서 프로젝트를 생성했습니다."); }} /> : null}
  </div>;
}
