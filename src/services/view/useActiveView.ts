import { useEffect, useState } from "react";
import { ViewService, type ActivityViewId } from "./viewService";

export function useActiveView(): ActivityViewId {
  const [activeViewId, setActiveViewId] = useState(() =>
    ViewService.getActiveViewId(),
  );

  useEffect(() => {
    return ViewService.onDidChange(() => {
      setActiveViewId(ViewService.getActiveViewId());
    });
  }, []);

  return activeViewId;
}
