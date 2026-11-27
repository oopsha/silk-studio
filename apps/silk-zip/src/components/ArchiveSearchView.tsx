import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import ResourceIconView from "@silk-studio/workbench/components/explorer/ResourceIconView.tsx";
import type { ArchiveListing } from "../archive";
import { buildSearchIndex, type SearchItem } from "../archiveSource";
import { tr } from "../i18n";

/** Dispatched on `window` to focus the search input (Ctrl+F while the view is already open). */
export const FOCUS_SEARCH_EVENT = "silkZip:focusSearch";
const RESULT_LIMIT = 500;

function createMatcher(query: string, caseSensitive: boolean): ((name: string) => boolean) | null {
  const text = query.trim();
  if (!text) return null;
  const flags = caseSensitive ? "" : "i";
  if (/[*?]/.test(text)) {
    // Wildcards match the whole name: * = any run of characters, ? = one character.
    const pattern = text.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    const regex = new RegExp(`^${pattern}$`, flags);
    return (name) => regex.test(name);
  }
  const needle = caseSensitive ? text : text.toLocaleLowerCase();
  return (name) => (caseSensitive ? name : name.toLocaleLowerCase()).includes(needle);
}

interface ArchiveSearchViewProps {
  archive: ArchiveListing;
  /** Folder shown in the list; used by the "현재 폴더 안에서" option. */
  folder: string;
  onReveal: (item: SearchItem) => void;
}

/** Sidebar view that finds files and folders by name anywhere in the opened archive. */
export default function ArchiveSearchView({ archive, folder, onReveal }: ArchiveSearchViewProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [inFolder, setInFolder] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const index = useMemo(() => buildSearchIndex(archive), [archive]);
  const deferred = useDeferredValue(query);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    const focus = () => { input.current?.focus(); input.current?.select(); };
    window.addEventListener(FOCUS_SEARCH_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus);
  }, []);

  const { results, total } = useMemo(() => {
    const matches = createMatcher(deferred, caseSensitive);
    if (!matches) return { results: [] as SearchItem[], total: 0 };
    const scope = inFolder && folder ? `${folder}/` : "";
    const found = index.filter((item) => (!scope || item.path.startsWith(scope)) && matches(item.name));
    found.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { results: found.slice(0, RESULT_LIMIT), total: found.length };
  }, [index, deferred, caseSensitive, inFolder, folder]);

  const searching = query.trim() !== "";
  return (
    <div className="zip-search">
      <div className="zip-search__field">
        <input ref={input} value={query} spellCheck={false} placeholder={tr("이름 검색 (*, ? 사용 가능)")} aria-label={tr("이름 검색")} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} />
        <button type="button" className={`zip-search__toggle${caseSensitive ? " zip-search__toggle--on" : ""}`} title={tr("대소문자 구분")} aria-label={tr("대소문자 구분")} aria-pressed={caseSensitive} onClick={() => setCaseSensitive((on) => !on)}><Codicon name="case-sensitive" /></button>
      </div>
      <label className="zip-search__option"><input type="checkbox" checked={inFolder} onChange={(event) => setInFolder(event.target.checked)} />{" "}{tr("현재 폴더 안에서만")}</label>
      {searching ? <p className="zip-search__summary" role="status">{total === 0 ? tr("일치하는 항목이 없습니다.") : total > RESULT_LIMIT ? tr("{0}개 중 처음 {1}개를 표시합니다.", total.toLocaleString(), RESULT_LIMIT.toLocaleString()) : tr("{0}개 항목", total.toLocaleString())}</p> : null}
      <ul className="zip-search__results" aria-label={tr("검색 결과")}>
        {results.map((item) => {
          return <li key={item.id}>
            <button type="button" className={activeId === item.id ? "zip-search__result zip-search__result--active" : "zip-search__result"} title={item.path} onClick={() => { setActiveId(item.id); onReveal(item); }}>
              <ResourceIconView node={item} />
              <span className="zip-search__name">{item.name}</span>
              <span className="zip-search__path">{item.parent}</span>
            </button>
          </li>;
        })}
      </ul>
    </div>
  );
}
