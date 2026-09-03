import { tKey } from "@silk-studio/workbench/platform/i18n/activeLocale.ts";
import { bridgeListMetadata, bridgeSetCatalog, bridgeSetSchema } from "./connectionBridge";
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
   * Switch the JDBC session's current schema (Oracle/PostgreSQL — dialects with no catalog
   * concept, where schema is the browsable namespace) and rebind the active tab, mirroring
   * {@link useDatabase} for catalog-capable dialects.
   */
  async useSchema(profileId: string, schemaName: string): Promise<string> {
    const id = profileId.trim();
    const schema = schemaName.trim();
    if (!id || !schema) {
      throw new Error(tKey("app.explorer.useSchemaFailed"));
    }

    const profile = ConnectionService.getProfile(id);
    if (!profile) {
      throw new Error(tKey("app.query.noConnectionTarget"));
    }
    if (!getConnectionDriver(profile.driverId).supportsRuntimeSchemaSwitch) {
      throw new Error(tKey("app.explorer.useSchemaUnsupported"));
    }

    await ensureExecutionConnection(id, { skipCatalogApply: true });
    const applied = await bridgeSetSchema(id, schema);
    EditorConnectionBindingService.setSchemaForProfile(id, applied);
    return applied;
  }

  /**
   * Persist schema as the connection profile default, then switch the session
   * to that schema (same as "Use this schema").
   */
  async setDefaultSchema(profileId: string, schemaName: string): Promise<string> {
    const id = profileId.trim();
    const schema = schemaName.trim();
    if (!id || !schema) {
      throw new Error(tKey("app.explorer.setDefaultSchemaFailed"));
    }

    const profile = ConnectionService.getProfile(id);
    if (!profile) {
      throw new Error(tKey("app.query.noConnectionTarget"));
    }
    if (!getConnectionDriver(profile.driverId).supportsRuntimeSchemaSwitch) {
      throw new Error(tKey("app.explorer.useSchemaUnsupported"));
    }

    ConnectionService.setDefaultSchema(id, schema);
    return this.useSchema(id, schema);
  }

  /**
   * Re-apply the active tab's bound schema before execute, for the same reason
   * {@link applyBindingCatalogForExecute} does for catalog: the JDBC session is shared across
   * every tab bound to this profile, so another tab's {@link useSchema} call can leave the
   * session on a schema this tab didn't ask for.
   */
  async applyBindingSchemaForExecute(connectionId: string): Promise<void> {
    const id = connectionId.trim();
    if (!id) return;

    const profile = ConnectionService.getProfile(id);
    if (!profile || !getConnectionDriver(profile.driverId).supportsRuntimeSchemaSwitch) {
      return;
    }

    const profileSchema = effectiveDefaultSchema(profile);
    const binding = EditorConnectionBindingService.getActiveBinding();
    const fromBinding =
      binding.profileId === id ? binding.schema?.trim() || "" : "";
    const bindingIsProfileDefault =
      !fromBinding ||
      (profileSchema.length > 0 &&
        fromBinding.toLowerCase() === profileSchema.toLowerCase());
    if (!fromBinding || bindingIsProfileDefault) return;

    try {
      const applied = await bridgeSetSchema(id, fromBinding);
      EditorConnectionBindingService.setSchemaForProfile(id, applied);
    } catch (error) {
      console.warn("[active-database] apply schema before execute failed", error);
    }
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
