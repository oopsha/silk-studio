import {
  loadQueryFavorites,
  saveQueryFavorites,
} from "./queryHistoryStorage";
import type { QueryFavorite } from "./queryHistoryTypes";

type FavoritesListener = () => void;

class QueryFavoritesServiceImpl {
  private favorites: QueryFavorite[] = loadQueryFavorites();
  private readonly listeners = new Set<FavoritesListener>();

  getFavorites(): readonly QueryFavorite[] {
    return this.favorites;
  }

  add(name: string, sql: string): QueryFavorite {
    const trimmedSql = sql.trim();
    const trimmedName = name.trim() || defaultFavoriteName(trimmedSql);
    const now = Date.now();
    const favorite: QueryFavorite = {
      id: crypto.randomUUID(),
      name: trimmedName,
      sql: trimmedSql,
      createdAt: now,
      updatedAt: now,
    };
    this.favorites = [favorite, ...this.favorites];
    saveQueryFavorites(this.favorites);
    this.fireDidChange();
    return favorite;
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    let changed = false;
    this.favorites = this.favorites.map((favorite) => {
      if (favorite.id !== id) return favorite;
      changed = true;
      return { ...favorite, name: trimmed, updatedAt: Date.now() };
    });
    if (!changed) return;
    saveQueryFavorites(this.favorites);
    this.fireDidChange();
  }

  remove(id: string): void {
    const next = this.favorites.filter((favorite) => favorite.id !== id);
    if (next.length === this.favorites.length) return;
    this.favorites = next;
    saveQueryFavorites(this.favorites);
    this.fireDidChange();
  }

  onDidChange(listener: FavoritesListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fireDidChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function defaultFavoriteName(sql: string): string {
  const firstLine = sql.split(/\r?\n/, 1)[0]?.trim() || "Favorite query";
  return firstLine.length > 48 ? `${firstLine.slice(0, 47)}…` : firstLine;
}

export const QueryFavoritesService = new QueryFavoritesServiceImpl();
