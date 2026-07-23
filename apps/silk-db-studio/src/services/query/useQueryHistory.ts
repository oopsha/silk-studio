import { useEffect, useState } from "react";
import { QueryFavoritesService } from "./queryFavoritesService";
import { QueryHistoryService } from "./queryHistoryService";
import type { QueryFavorite, QueryHistoryEntry } from "./queryHistoryTypes";

export function useQueryHistory(): readonly QueryHistoryEntry[] {
  const [entries, setEntries] = useState(() => QueryHistoryService.getEntries());

  useEffect(() => {
    return QueryHistoryService.onDidChange(() => {
      setEntries([...QueryHistoryService.getEntries()]);
    });
  }, []);

  return entries;
}

export function useQueryFavorites(): readonly QueryFavorite[] {
  const [favorites, setFavorites] = useState(() =>
    QueryFavoritesService.getFavorites(),
  );

  useEffect(() => {
    return QueryFavoritesService.onDidChange(() => {
      setFavorites([...QueryFavoritesService.getFavorites()]);
    });
  }, []);

  return favorites;
}
