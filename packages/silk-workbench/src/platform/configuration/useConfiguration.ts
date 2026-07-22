import { useEffect, useState } from "react";
import { ConfigurationService } from "./configurationService";
import type { WorkbenchConfiguration } from "./configurationDefaults";

export function useConfiguration(): WorkbenchConfiguration {
  const [configuration, setConfiguration] = useState(() =>
    ConfigurationService.getAll(),
  );

  useEffect(() => {
    return ConfigurationService.onDidChange(() => {
      setConfiguration(ConfigurationService.getAll());
    });
  }, []);

  return configuration;
}
