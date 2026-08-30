import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { ConnectionService } from "../connection/connectionService";
import { EditorConnectionBindingService } from "../connection/editorConnectionBindingService";

/**
 * Resolve which JDBC session (profile id = connectionId) a query should use.
 * Prefer an explicit override (Open Data / explorer / PL/SQL), else the active
 * editor tab binding. Never silently fall back to another connected profile.
 */
export function resolveExecutionConnectionId(options?: {
  connectionId?: string | null;
}): string {
  const override = options?.connectionId?.trim();
  if (override) {
    return override;
  }

  const binding = EditorConnectionBindingService.getActiveBinding();
  const fromBinding = binding.profileId?.trim();
  if (fromBinding) {
    return fromBinding;
  }

  throw new Error(tKey("app.query.noConnectionTarget"));
}

/** Ensure the given profile session is open (reconnect that profile only). */
export async function ensureExecutionConnection(
  connectionId: string,
  options?: { skipCatalogApply?: boolean },
): Promise<void> {
  if (!ConnectionService.isConnected(connectionId)) {
    const profile = ConnectionService.getProfile(connectionId);
    if (!profile) {
      throw new Error(tKey("app.query.noConnectionTarget"));
    }

    try {
      await ConnectionService.connect(connectionId, { silent: true });
    } catch {
      // Surface a clear disconnected message rather than the raw connect error.
    }

    if (!ConnectionService.isConnected(connectionId)) {
      throw new Error(
        tKey("app.query.connectionDisconnected").replace(
          "{name}",
          profile.name,
        ),
      );
    }
  }

  if (options?.skipCatalogApply) {
    return;
  }

  const { ActiveDatabaseService } = await import(
    "../connection/activeDatabaseService"
  );
  await ActiveDatabaseService.applyBindingCatalogForExecute(connectionId);
  await ActiveDatabaseService.applyBindingSchemaForExecute(connectionId);
}
