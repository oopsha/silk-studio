import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { bridgeListMetadata, bridgeSetCatalog } from "./connectionBridge";
import { ConnectionService } from "./connectionService";
import { ConnectionTreeService } from "./connectionTreeService";
import {
  effectiveDefaultSchema,
  getConnectionDriver,
} from "./connectionTypes";
import { EditorConnectionBindingService } from "./editorConnectionBindingService";
import { ensureExecutionConnection } from "../query/resolveExecutionConnection";

/**
 * Session-only active database (catalog) for SQL Server / MySQL-style drivers.
 * Does not persist to the connection profile's default catalog.
 */
class ActiveDatabaseServiceImpl {
  /**
   * Switch the JDBC session + editor bindings + explorer highlight to `catalogName`,
   * then preload schema list + default-schema objects for filter/completion.
   */
  async useDatabase(profileId: string, catalogName: string): Promise<string> {
    const id = profileId.trim();
    const catalog = catalogName.trim();
    if (!id || !catalog) {
      throw new Error(tKey("app.explorer.useDatabaseFailed"));
    }

    const profile = ConnectionService.getProfile(id);
    if (!profile) {
      throw new Error(tKey("app.query.noConnectionTarget"));
    }
    if (!getConnectionDriver(profile.driverId).supportsCatalog) {
      throw new Error(tKey("app.explorer.useDatabaseUnsupported"));
    }

    // Connect only — do not re-apply profile default catalog before switching.
    await ensureExecutionConnection(id, { skipCatalogApply: true });
    const applied = await this.applyCatalog(id, catalog);
    ConnectionTreeService.setCurrentCatalog(id, applied);
    EditorConnectionBindingService.setCatalogForProfile(id, applied);

    // Background preload — do not block the "using database" feedback.
    void this.preloadCatalog(id, applied).catch((error) => {
      console.warn(
        "[active-database] preload after useDatabase failed",
        applied,
        error,
      );
    });

    return applied;
  }

  /**
   * Persist catalog as the connection profile default, then switch the session
   * to that database (same as "Use this database").
   */
  async setDefaultDatabase(
    profileId: string,
    catalogName: string,
  ): Promise<string> {
    const id = profileId.trim();
    const catalog = catalogName.trim();
    if (!id || !catalog) {
      throw new Error(tKey("app.explorer.setDefaultDatabaseFailed"));
    }

    const profile = ConnectionService.getProfile(id);
    if (!profile) {
      throw new Error(tKey("app.query.noConnectionTarget"));
    }
    if (!getConnectionDriver(profile.driverId).supportsCatalog) {
      throw new Error(tKey("app.explorer.useDatabaseUnsupported"));
    }

    ConnectionService.setDefaultCatalog(id, catalog);
    return this.useDatabase(id, catalog);
  }

  /**
   * Load schema list for the catalog, then objects under the default schema
   * (profile default / dbo / first schema) so explorer filter can match tables.
   */
  private async preloadCatalog(
    profileId: string,
    catalogName: string,
  ): Promise<void> {
    await ConnectionTreeService.loadCatalogSchemas(profileId, catalogName);
    if (!ConnectionService.isConnected(profileId)) return;

    const schemaName = this.resolvePreloadSchema(profileId, catalogName);
    if (!schemaName) return;

    await ConnectionTreeService.loadSchemaObjects(
      profileId,
      schemaName,
      false,
      catalogName,
    );
  }

  private resolvePreloadSchema(
    profileId: string,
    catalogName: string,
  ): string | null {
    const profile = ConnectionService.getProfile(profileId);
    const cache = ConnectionTreeService.getCache(profileId);
    const catalog = cache.catalogs.find(
      (item) => item.name.toLowerCase() === catalogName.toLowerCase(),
    );
    const schemaNames = catalog?.schemas.map((item) => item.name) ?? [];
    if (schemaNames.length === 0) return null;

    const candidates: string[] = [];
    const binding = EditorConnectionBindingService.getActiveBinding();
    if (binding.profileId === profileId && binding.schema?.trim()) {
      candidates.push(binding.schema.trim());
    }
    if (profile) {
      const effective = effectiveDefaultSchema(profile).trim();
      if (effective) candidates.push(effective);
    }
    candidates.push("dbo", "public");

    for (const name of candidates) {
      const match = schemaNames.find(
        (schema) => schema.toLowerCase() === name.toLowerCase(),
      );
      if (match) return match;
    }

    return schemaNames[0] ?? null;
  }

  /**
   * Apply catalog on the JDBC session. Prefers `connection_set_catalog`; falls
   * back to metadata (which also calls setCatalog) if the command is denied.
   */
  private async applyCatalog(
    connectionId: string,
    catalog: string,
  ): Promise<string> {
    try {
      return await bridgeSetCatalog(connectionId, catalog);
    } catch (error) {
      console.warn(
        "[active-database] setCatalog failed; falling back to metadata",
        error,
      );
      const result = await bridgeListMetadata(
        connectionId,
        undefined,
        catalog,
      );
      return result.currentCatalog?.trim() || catalog;
    }
  }

  /**
   * Apply the session / binding catalog before query execution so unqualified
   * object names resolve against the chosen database.
   *
   * Editor bindings are seeded with the profile default catalog, so a session
   * `currentCatalog` from explorer / "Use this database" must win when the
   * binding still equals that profile default.
   */
  async applyBindingCatalogForExecute(connectionId: string): Promise<void> {
    const id = connectionId.trim();
    if (!id) return;

    const profile = ConnectionService.getProfile(id);
    if (!profile || !getConnectionDriver(profile.driverId).supportsCatalog) {
      return;
    }

    const profileCatalog = profile.catalog.trim();
    const binding = EditorConnectionBindingService.getActiveBinding();
    const fromBinding =
      binding.profileId === id ? binding.catalog?.trim() || "" : "";
    const fromSession =
      ConnectionTreeService.getCache(id).currentCatalog?.trim() || "";

    const bindingIsProfileDefault =
      !fromBinding ||
      (profileCatalog.length > 0 &&
        fromBinding.toLowerCase() === profileCatalog.toLowerCase());

    let catalog = "";
    if (fromBinding && !bindingIsProfileDefault) {
      catalog = fromBinding;
    } else if (fromSession) {
      catalog = fromSession;
    } else {
      catalog = fromBinding || profileCatalog;
    }
    if (!catalog) return;

    try {
      const applied = await this.applyCatalog(id, catalog);
      ConnectionTreeService.setCurrentCatalog(id, applied);
    } catch (error) {
      console.warn("[active-database] apply catalog before execute failed", error);
    }
  }
}

export const ActiveDatabaseService = new ActiveDatabaseServiceImpl();
