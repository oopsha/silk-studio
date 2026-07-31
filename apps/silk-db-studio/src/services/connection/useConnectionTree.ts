import { useEffect, useState } from "react";
import {
  ConnectionTreeService,
  type ProfileTreeCache,
  type SchemaTreeNode,
} from "./connectionTreeService";

const EMPTY_CACHE: ProfileTreeCache = {
  status: "idle",
  errorMessage: null,
  catalogs: [],
  currentCatalog: null,
  schemas: [],
};

/** Schemas visible for completion/search: flat list or current catalog's schemas. */
export function getExplorerSchemas(cache: ProfileTreeCache): SchemaTreeNode[] {
  if (cache.catalogs.length === 0) {
    return cache.schemas;
  }
  const current = cache.currentCatalog?.trim().toLowerCase() ?? "";
  const preferred =
    (current
      ? cache.catalogs.find((item) => item.name.toLowerCase() === current)
      : undefined) ??
    cache.catalogs.find((item) => item.status === "loaded") ??
    cache.catalogs[0];
  return preferred?.schemas ?? [];
}

export function useConnectionTree(profileId: string | null): ProfileTreeCache {
  const [cache, setCache] = useState<ProfileTreeCache>(() =>
    profileId ? ConnectionTreeService.getCache(profileId) : EMPTY_CACHE,
  );

  useEffect(() => {
    function sync() {
      setCache(
        profileId ? ConnectionTreeService.getCache(profileId) : EMPTY_CACHE,
      );
    }
    sync();
    return ConnectionTreeService.onDidChange(sync);
  }, [profileId]);

  return cache;
}
