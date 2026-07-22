import { useEffect, useState } from "react";
import { SettingsService } from "./settingsService";
import type { SettingsCategory } from "./settingsConstants";

export function useSettingsCategory(): SettingsCategory {
  const [category, setCategory] = useState(() =>
    SettingsService.getActiveCategory(),
  );

  useEffect(() => {
    return SettingsService.onDidOpen(setCategory);
  }, []);

  return category;
}
