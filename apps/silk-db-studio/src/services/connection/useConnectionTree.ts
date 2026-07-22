import { useEffect, useState } from "react";
import {
  ConnectionTreeService,
  type ProfileTreeCache,
} from "./connectionTreeService";

export function useConnectionTree(profileId: string | null): ProfileTreeCache {
  const [cache, setCache] = useState<ProfileTreeCache>(() =>
    profileId
      ? ConnectionTreeService.getCache(profileId)
      : { status: "idle", errorMessage: null, schemas: [] },
  );

  useEffect(() => {
    function sync() {
      setCache(
        profileId
          ? ConnectionTreeService.getCache(profileId)
          : { status: "idle", errorMessage: null, schemas: [] },
      );
    }
    sync();
    return ConnectionTreeService.onDidChange(sync);
  }, [profileId]);

  return cache;
}
