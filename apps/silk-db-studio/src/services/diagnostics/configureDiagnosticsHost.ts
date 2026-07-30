import { configureDiagnosticsHost } from "@silk-studio/workbench/services/diagnostics/diagnosticsHost.ts";
import { ConnectionService } from "../connection/connectionService";
import { getConnectionDriver } from "../connection/connectionTypes";

/** Strip credentials from JDBC URLs for diagnostics hints. */
function hostHintFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  // Drop userinfo if present (jdbc:…://user:pass@host).
  const withoutUserinfo = trimmed.replace(
    /(\/\/)([^/@]+)@/g,
    (_, slash) => `${slash}`,
  );

  // Prefer host:port fragment when recognizable.
  const hostMatch = withoutUserinfo.match(
    /(?:@|\/\/)([^/;?\s]+)/,
  );
  if (hostMatch?.[1]) {
    return hostMatch[1];
  }

  return withoutUserinfo.slice(0, 120);
}

/** Wire DB Studio connection state into Help → Copy diagnostics. */
export function configureDbStudioDiagnosticsHost(): void {
  configureDiagnosticsHost({
    getConnectionSummary: () => {
      const state = ConnectionService.getState();
      const profile = ConnectionService.getConnectedProfile();
      if (!profile) {
        return {
          status: state.status,
        };
      }
      const driver = getConnectionDriver(profile.driverId);
      return {
        status: state.status,
        profileName: profile.name,
        driverId: driver.id,
        hostHint: hostHintFromUrl(profile.url),
      };
    },
  });
}
