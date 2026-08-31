import { useMemo, useState } from "react";
import Codicon from "@silk-studio/ui/components/icons/Codicon.tsx";
import { I18nService } from "@silk-studio/workbench/platform/i18n/i18nService.ts";
import { useI18n } from "@silk-studio/workbench/platform/i18n/useI18n.ts";
import ContextMenu, { type ContextMenuItem } from "../common/ContextMenu";
import { ConfirmDialogService } from "../../services/ui/confirmDialogService";
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
    I18nService.t("app.query.favoriteDefaultName");
  const name = window.prompt(
    I18nService.t("app.query.favoriteNamePrompt"),
    suggested,
  );
  if (name === null) return null;
  return name.trim() || suggested;
}

function HistoryItem({ entry }: { entry: QueryHistoryEntry }) {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(
    null,
  );

  const menuItems: ContextMenuItem[] = [
    { id: "run", label: t("common.run"), enabled: true },
    { id: "openInEditor", label: t("app.query.openInEditor"), enabled: true },
    {
      id: "insertIntoEditor",
      label: t("app.query.insertIntoEditor"),
      enabled: true,
    },
    {
      id: "addToFavorites",
      label: t("app.query.addToFavorites"),
      enabled: true,
      separator: true,
    },
    {
      id: "delete",
      label: t("common.delete"),
      enabled: true,
      separator: true,
      dangerous: true,
    },
  ];

  function handleMenuSelect(item: ContextMenuItem) {
    switch (item.id) {
      case "run":
        void reexecuteSql(entry.sql);
        return;
      case "openInEditor":
        openSqlInEditor(entry.sql);
        return;
      case "insertIntoEditor":
        insertSqlIntoActiveEditor(entry.sql);
        return;
      case "addToFavorites": {
        const name = promptFavoriteName(entry.sql);
        if (name === null) return;
        QueryFavoritesService.add(name, entry.sql);
        return;
      }
      case "delete":
        QueryHistoryService.remove(entry.id);
        return;
      default:
        return;
    }
  }

  return (
    <div
      className={`query-history__item query-history__item--${entry.status}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {contextMenu ? (
        <ContextMenu
          anchor={{ top: contextMenu.y, left: contextMenu.x }}
          items={menuItems}
          onClose={() => setContextMenu(null)}
          onSelect={handleMenuSelect}
        />
      ) : null}
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
          title={t("common.run")}
          aria-label={t("common.run")}
          onClick={() => void reexecuteSql(entry.sql)}
        >
          <Codicon name="play" />
        </button>
        <button
          type="button"
          title={t("app.query.openInEditor")}
          aria-label={t("app.query.openInEditor")}
          onClick={() => openSqlInEditor(entry.sql)}
        >
          <Codicon name="file-code" />
        </button>
        <button
          type="button"
          title={t("app.query.insertIntoEditor")}
          aria-label={t("app.query.insertIntoEditor")}
          onClick={() => insertSqlIntoActiveEditor(entry.sql)}
        >
          <Codicon name="add" />
        </button>
        <button
          type="button"
          title={t("app.query.addToFavorites")}
          aria-label={t("app.query.addToFavorites")}
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
          title={t("common.delete")}
          aria-label={t("common.delete")}
          onClick={() => QueryHistoryService.remove(entry.id)}
        >
          <Codicon name="trash" />
        </button>
      </div>
    </div>
  );
}

function FavoriteItem({ favorite }: { favorite: QueryFavorite }) {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(
    null,
  );

  const menuItems: ContextMenuItem[] = [
    { id: "run", label: t("common.run"), enabled: true },
    { id: "openInEditor", label: t("app.query.openInEditor"), enabled: true },
    {
      id: "insertIntoEditor",
      label: t("app.query.insertIntoEditor"),
      enabled: true,
    },
    {
      id: "rename",
      label: t("common.rename"),
      enabled: true,
      separator: true,
    },
    {
      id: "delete",
      label: t("common.delete"),
      enabled: true,
      separator: true,
      dangerous: true,
    },
  ];

  function handleMenuSelect(item: ContextMenuItem) {
    switch (item.id) {
      case "run":
        void reexecuteSql(favorite.sql);
        return;
      case "openInEditor":
        openSqlInEditor(favorite.sql, favorite.name);
        return;
      case "insertIntoEditor":
        insertSqlIntoActiveEditor(favorite.sql);
        return;
      case "rename": {
        const name = promptFavoriteName(favorite.sql, favorite.name);
        if (name === null) return;
        QueryFavoritesService.rename(favorite.id, name);
        return;
      }
      case "delete":
        QueryFavoritesService.remove(favorite.id);
        return;
      default:
        return;
    }
  }

  return (
    <div
      className="query-history__item"
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {contextMenu ? (
        <ContextMenu
          anchor={{ top: contextMenu.y, left: contextMenu.x }}
          items={menuItems}
          onClose={() => setContextMenu(null)}
          onSelect={handleMenuSelect}
        />
      ) : null}
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
          title={t("common.run")}
          aria-label={t("common.run")}
          onClick={() => void reexecuteSql(favorite.sql)}
        >
          <Codicon name="play" />
        </button>
        <button
          type="button"
          title={t("app.query.openInEditor")}
          aria-label={t("app.query.openInEditor")}
          onClick={() => openSqlInEditor(favorite.sql, favorite.name)}
        >
          <Codicon name="file-code" />
        </button>
        <button
          type="button"
          title={t("app.query.insertIntoEditor")}
          aria-label={t("app.query.insertIntoEditor")}
          onClick={() => insertSqlIntoActiveEditor(favorite.sql)}
        >
          <Codicon name="add" />
        </button>
        <button
          type="button"
          title={t("common.rename")}
          aria-label={t("common.rename")}
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
          title={t("common.delete")}
          aria-label={t("common.delete")}
          onClick={() => QueryFavoritesService.remove(favorite.id)}
        >
          <Codicon name="trash" />
        </button>
      </div>
    </div>
  );
}

function matchesHistoryFilter(entry: QueryHistoryEntry, filter: string): boolean {
  return [entry.sql, entry.summary, entry.connectionName, entry.status]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(filter));
}

function matchesFavoriteFilter(favorite: QueryFavorite, filter: string): boolean {
  return [favorite.name, favorite.sql].some((value) =>
    value.toLocaleLowerCase().includes(filter),
  );
}

function QueryHistoryView() {
  const { t } = useI18n();
  const history = useQueryHistory();
  const favorites = useQueryFavorites();
  const [tab, setTab] = useState<TabId>("history");
  const [filter, setFilter] = useState("");
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const filteredHistory = useMemo(
    () =>
      normalizedFilter
        ? history.filter((entry) => matchesHistoryFilter(entry, normalizedFilter))
        : history,
    [history, normalizedFilter],
  );
  const filteredFavorites = useMemo(
    () =>
      normalizedFilter
        ? favorites.filter((favorite) =>
            matchesFavoriteFilter(favorite, normalizedFilter),
          )
        : favorites,
    [favorites, normalizedFilter],
  );

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
          {t("app.query.historyTab")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "favorites"}
          className={`query-history__tab${tab === "favorites" ? " query-history__tab--active" : ""}`}
          onClick={() => setTab("favorites")}
        >
          {t("app.query.favoritesTab")}
        </button>
        {tab === "history" ? (
          <button
            type="button"
            className="query-history__clear"
            title={t("app.query.clearHistory")}
            aria-label={t("app.query.clearHistory")}
            disabled={history.length === 0}
            onClick={() => {
              if (history.length === 0) return;
              void ConfirmDialogService.confirm({
                title: t("app.query.clearHistory"),
                message: t("app.query.clearHistoryConfirm"),
                confirmLabel: t("app.query.clearHistory"),
                danger: true,
              }).then((confirmed) => {
                if (confirmed) {
                  QueryHistoryService.clear();
                }
              });
            }}
          >
            <Codicon name="trash" />
          </button>
        ) : null}
      </div>

      <div className="query-history__filter">
        <Codicon name="search" />
        <input
          type="search"
          className="query-history__filter-input"
          placeholder={t("app.query.filterPlaceholder")}
          aria-label={t("app.query.filterAria")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {filter ? (
          <button
            type="button"
            className="query-history__filter-clear"
            title={t("app.query.clearFilter")}
            aria-label={t("app.query.clearFilter")}
            onClick={() => setFilter("")}
          >
            <Codicon name="clear-all" />
          </button>
        ) : null}
      </div>

      <div className="query-history__list">
        {tab === "history" ? (
          filteredHistory.length === 0 ? (
            <div className="query-history__empty">
              {history.length === 0
                ? t("app.query.historyEmpty")
                : t("app.query.filterEmpty")}
            </div>
          ) : (
            filteredHistory.map((entry) => (
              <HistoryItem key={entry.id} entry={entry} />
            ))
          )
        ) : filteredFavorites.length === 0 ? (
          <div className="query-history__empty">
            {favorites.length === 0
              ? t("app.query.favoritesEmpty")
              : t("app.query.filterEmpty")}
          </div>
        ) : (
          filteredFavorites.map((favorite) => (
            <FavoriteItem key={favorite.id} favorite={favorite} />
          ))
        )}
      </div>
    </div>
  );
}

export default QueryHistoryView;
