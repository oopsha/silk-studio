import { useEffect, useMemo, useRef, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import { useActiveEditor } from "@silk-studio/editor/services/editor/useActiveEditor.ts";
import { EditorService } from "@silk-studio/editor/services/editor/editorServiceFacade.ts";
import { OutlineViewState } from "@silk-studio/workbench/services/outline/outlineViewState.ts";
import { useOutlineViewState } from "@silk-studio/workbench/services/outline/useOutlineViewState.ts";
import { isSqlLanguageId } from "../../services/sql/sqlDialect";
import {
  buildSqlOutline,
  outlineCategoryIcon,
  type SqlOutlineCategory,
  type SqlOutlineEntry,
} from "../../services/outline/sqlOutlineService";
import "./OutlineView.css";

const CONTENT_DEBOUNCE_MS = 300;

const CATEGORY_LABELS: Record<SqlOutlineCategory, string> = {
  table: "Tables",
  view: "Views",
  index: "Indexes",
  procedure: "Procedures",
  function: "Functions",
  package: "Packages",
  trigger: "Triggers",
  type: "Types",
  sequence: "Sequences",
  query: "Queries",
  dml: "DML",
  block: "Blocks",
  other: "Other",
};

function jumpToOffset(offset: number): void {
  const editor = EditorService.getActiveTextEditor();
  const model = editor?.getModel();
  if (!editor || !model) return;
  const position = model.getPositionAt(offset);
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  editor.focus();
}

function sortEntries(
  entries: SqlOutlineEntry[],
  sortBy: "position" | "name" | "category",
): SqlOutlineEntry[] {
  if (sortBy === "position") return entries;
  if (sortBy === "name") {
    return [...entries].sort((a, b) =>
      (a.name ?? a.label).localeCompare(b.name ?? b.label),
    );
  }
  return [...entries].sort((a, b) => {
    if (a.category !== b.category) {
      return CATEGORY_LABELS[a.category].localeCompare(
        CATEGORY_LABELS[b.category],
      );
    }
    return a.start - b.start;
  });
}

function groupByCategory(
  entries: SqlOutlineEntry[],
): Map<SqlOutlineCategory, SqlOutlineEntry[]> {
  const groups = new Map<SqlOutlineCategory, SqlOutlineEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.category) ?? [];
    bucket.push(entry);
    groups.set(entry.category, bucket);
  }
  return groups;
}

function OutlineView() {
  const { t } = useI18n();
  const activeTab = useActiveEditor();
  const { followCursor, filterOnType, sortBy, collapsedCategories } =
    useOutlineViewState();

  const [content, setContent] = useState(activeTab?.content ?? "");
  const [filter, setFilter] = useState("");
  const [activeOffset, setActiveOffset] = useState<number | null>(null);
  const debounceRef = useRef<number | null>(null);

  const isSql = Boolean(activeTab && isSqlLanguageId(activeTab.languageId));

  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    if (!activeTab) {
      setContent("");
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      setContent(activeTab.content);
    }, CONTENT_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [activeTab, activeTab?.content]);

  useEffect(() => {
    if (!followCursor || !isSql) {
      setActiveOffset(null);
      return;
    }
    const editor = EditorService.getActiveTextEditor();
    if (!editor) return;
    const updateFromCursor = () => {
      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position) return;
      setActiveOffset(model.getOffsetAt(position));
    };
    updateFromCursor();
    const disposable = editor.onDidChangeCursorPosition(updateFromCursor);
    return () => disposable.dispose();
  }, [followCursor, isSql, activeTab?.id]);

  const allEntries = useMemo(
    () => (isSql ? buildSqlOutline(content) : []),
    [isSql, content],
  );

  const filteredEntries = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return allEntries;
    return allEntries.filter((entry) =>
      entry.label.toLowerCase().includes(query),
    );
  }, [allEntries, filter]);

  const sortedEntries = useMemo(
    () => sortEntries(filteredEntries, sortBy),
    [filteredEntries, sortBy],
  );

  const activeEntryId = useMemo(() => {
    if (activeOffset === null) return null;
    const hit = [...allEntries]
      .reverse()
      .find((entry) => activeOffset >= entry.start && activeOffset <= entry.end);
    return hit?.id ?? null;
  }, [allEntries, activeOffset]);

  const groups = useMemo(
    () => (sortBy === "category" ? groupByCategory(sortedEntries) : null),
    [sortBy, sortedEntries],
  );

  useEffect(() => {
    OutlineViewState.setKnownCategories(groups ? [...groups.keys()] : []);
  }, [groups]);

  function renderRow(entry: SqlOutlineEntry) {
    return (
      <button
        key={entry.id}
        type="button"
        className={`outline-view__row${entry.id === activeEntryId ? " outline-view__row--active" : ""}`}
        title={entry.label}
        onClick={() => jumpToOffset(entry.start)}
      >
        <Codicon name={outlineCategoryIcon(entry.category)} />
        <span className="outline-view__label">{entry.label}</span>
      </button>
    );
  }

  const filterBox = filterOnType ? (
    <div className="outline-view__filter">
      <input
        type="text"
        value={filter}
        placeholder={t("workbench.sidebar.outlineFilterPlaceholder")}
        onChange={(event) => setFilter(event.target.value)}
      />
    </div>
  ) : null;

  if (!activeTab) {
    return (
      <div className="accordion-panel__empty">
        {t("workbench.sidebar.outlineEmpty")}
      </div>
    );
  }

  if (!isSql || allEntries.length === 0) {
    return (
      <div className="accordion-panel__empty">
        {t("workbench.sidebar.outlineEmpty")}
      </div>
    );
  }

  if (sortedEntries.length === 0) {
    return (
      <div className="outline-view">
        {filterBox}
        <div className="accordion-panel__empty">
          {t("workbench.sidebar.outlineNoMatches")}
        </div>
      </div>
    );
  }

  if (!groups) {
    return (
      <div className="outline-view">
        {filterBox}
        <div className="outline-view__list">{sortedEntries.map(renderRow)}</div>
      </div>
    );
  }

  return (
    <div className="outline-view">
      {filterBox}
      <div className="outline-view__list">
        {[...groups.entries()].map(([category, entries]) => {
          const collapsed = collapsedCategories.has(category);
          return (
            <div key={category} className="outline-view__group">
              <button
                type="button"
                className="outline-view__group-header"
                onClick={() => OutlineViewState.toggleCategory(category)}
              >
                <Codicon name={collapsed ? "chevron-right" : "chevron-down"} />
                <span>{CATEGORY_LABELS[category]}</span>
                <span className="outline-view__group-count">{entries.length}</span>
              </button>
              {collapsed ? null : entries.map(renderRow)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default OutlineView;
