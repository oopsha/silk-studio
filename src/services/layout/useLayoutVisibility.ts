import { useEffect, useState } from "react";
import {
  LayoutService,
  type LayoutVisibility,
} from "./layoutService";

export function useLayoutVisibility(): LayoutVisibility {
  const [visibility, setVisibility] = useState(() =>
    LayoutService.getVisibility(),
  );

  useEffect(() => {
    return LayoutService.onDidChange(() => {
      setVisibility(LayoutService.getVisibility());
    });
  }, []);

  return visibility;
}
