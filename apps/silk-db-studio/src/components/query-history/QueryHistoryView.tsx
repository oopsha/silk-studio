import { useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { QueryFavoritesService } from "../../services/query/queryFavoritesService";
import { QueryHistoryService } from "../../services/query/queryHistoryService";
import type {
  QueryFavorite,
  QueryHistoryEntry,
} from "../../services/query/queryHistoryTypes";
import {
  insertSqlIntoActiveEditor,
  openSqlInEditor,
  reexecuteSql,
} from "../../services/query/querySqlActions";
import {
  useQueryFavorites,
  useQueryHistory,
} from "../../services/query/useQueryHistory";
import "./QueryHistoryView.css";

type TabId = "history" | "favorites";

function formatTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function previewSql(sql: string): string {
  const compact = sql.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 119)}…` : compact;
}

function statusIcon(status: QueryHistoryEntry["status"]): string {
  switch (status) {
    case "success":
      return "check";
    case "error":
      return "error";
    case "cancelled":
      return "debug-stop";
  }
}

function promptFavoriteName(sql: string, initial?: string): string | null {
  const suggested =
    initial?.trim() ||
    sql.split(/\r?\n/, 1)[0]?.trim().slice(0, 48) ||
    "Favorite query";
  const name = window.prompt("Favorite name", suggested);
  if (name === null) return null;
  return name.trim() || suggested;
}

function HistoryItem({ entry }: { entry: QueryHistoryEntry }) {
  return (
    <div className={`query-history__item query-history__item--${entry.status}`}>
      <div className="query-history__item-main">
        <div className="query-history__item-meta">
          <Codicon name={statusIcon(entry.status)} />
          <span>{formatTime(entry.executedAt)}</span>
          <span>{formatDuration(entry.durationMs)}</span>
          {entry.connectionName ? <span>{entry.connectionName}</span> : null}
        </div>
        <div className="query-history__item-sql" title={entry.sql}>
          {previewSql(entry.sql)}
        </div>
        {entry.summary ? (
          <div className="query-history__item-summary" title={entry.summary}>
            {entry.summary}
          </div>
        ) : null}
      </div>
      <div className="query-history__item-actions">
        <button
          type="button"
          title="Run"
          aria-label="Run"
          onClick={() => void reexecuteSql(entry.sql)}
        >
          <Codicon name="play" />
        </button>
        <button
          type="button"
          title="Open in Editor"
          aria-label="Open in Editor"
          onClick={() => openSqlInEditor(entry.sql)}
        >
          <Codicon name="file-code" />
        </button>
        <button
          type="button"
          title="Insert into Editor"
          aria-label="Insert into Editor"
          onClick={() => insertSqlIntoActiveEditor(entry.sql)}
        >
          <Codicon name="add" />
        </button>
        <button
          type="button"
          title="Add to Favorites"
          aria-label="Add to Favorites"
          onClick={() => {
            const name = promptFavoriteName(entry.sql);
            if (name === null) return;
            QueryFavoritesService.add(name, entry.sql);
          }}
        >
          <Codicon name="star" />
        </button>
        <button
          type="button"
          title="Delete"
          aria-label="Delete"
          onClick={() => QueryHistoryService.remove(entry.id)}
        >
          <Codicon name="trash" />
        </button>
      </div>
    </div>
  );
}

function FavoriteItem({ favorite }: { favorite: QueryFavorite }) {
  return (
    <div className="query-history__item">
      <div className="query-history__item-main">
        <div className="query-history__item-meta">
          <Codicon name="star" />
          <span className="query-history__item-name">{favorite.name}</span>
          <span>{formatTime(favorite.updatedAt)}</span>
        </div>
        <div className="query-history__item-sql" title={favorite.sql}>
          {previewSql(favorite.sql)}
        </div>
      </div>
      <div className="query-history__item-actions">
        <button
          type="button"
          title="Run"
          aria-label="Run"
          onClick={() => void reexecuteSql(favorite.sql)}
        >
          <Codicon name="play" />
        </button>
        <button
          type="button"
          title="Open in Editor"
          aria-label="Open in Editor"
          onClick={() => openSqlInEditor(favorite.sql, favorite.name)}
        >
          <Codicon name="file-code" />
        </button>
        <button
          type="button"
          title="Insert into Editor"
          aria-label="Insert into Editor"
          onClick={() => insertSqlIntoActiveEditor(favorite.sql)}
        >
          <Codicon name="add" />
        </button>
        <button
          type="button"
          title="Rename"
          aria-label="Rename"
          onClick={() => {
            const name = promptFavoriteName(favorite.sql, favorite.name);
            if (name === null) return;
            QueryFavoritesService.rename(favorite.id, name);
          }}
        >
          <Codicon name="edit" />
        </button>
        <button
          type="button"
          title="Delete"
          aria-label="Delete"
          onClick={() => QueryFavoritesService.remove(favorite.id)}
        >
          <Codicon name="trash" />
        </button>
      </div>
    </div>
  );
}

function QueryHistoryView() {
  const history = useQueryHistory();
  const favorites = useQueryFavorites();
  const [tab, setTab] = useState<TabId>("history");

  return (
    <div className="query-history">
      <div className="query-history__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={`query-history__tab${tab === "history" ? " query-history__tab--active" : ""}`}
          onClick={() => setTab("history")}
        >
          History
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "favorites"}
          className={`query-history__tab${tab === "favorites" ? " query-history__tab--active" : ""}`}
          onClick={() => setTab("favorites")}
        >
          Favorites
        </button>
        {tab === "history" ? (
          <button
            type="button"
            className="query-history__clear"
            title="Clear History"
            aria-label="Clear History"
            disabled={history.length === 0}
            onClick={() => {
              if (
                history.length > 0 &&
                window.confirm("Clear all query history?")
              ) {
                QueryHistoryService.clear();
              }
            }}
          >
            <Codicon name="trash" />
          </button>
        ) : null}
      </div>

      <div className="query-history__list">
        {tab === "history" ? (
          history.length === 0 ? (
            <div className="query-history__empty">
              Run a SQL statement to build history.
            </div>
          ) : (
            history.map((entry) => <HistoryItem key={entry.id} entry={entry} />)
          )
        ) : favorites.length === 0 ? (
          <div className="query-history__empty">
            Star a history item or save SQL as a favorite.
          </div>
        ) : (
          favorites.map((favorite) => (
            <FavoriteItem key={favorite.id} favorite={favorite} />
          ))
        )}
      </div>
    </div>
  );
}

export default QueryHistoryView;
