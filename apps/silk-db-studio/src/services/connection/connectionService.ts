import {
  bridgeConnect,
  bridgeDisconnect,
  bridgeTestConnection,
} from "./connectionBridge";
import {
  secretDelete,
  secretGet,
  secretSet,
} from "./connectionSecretBridge";
import {
  extractLegacyPasswords,
  loadActiveProfileId,
  loadConnectionProfiles,
  saveActiveProfileId,
  saveConnectionProfiles,
} from "./connectionStorage";
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionState,
} from "./connectionTypes";
import {
  defaultUrlForDriver,
  effectiveDefaultSchema,
  getConnectionDriver,
  isProfileConnected,
  isProfileConnecting,
} from "./connectionTypes";
import { ConfigurationService } from "@silk-studio/workbench/platform/configuration/configurationService.ts";
import { reportError } from "../formatErrorMessage";
import { ConnectionTreeService } from "./connectionTreeService";
import {
  EMPTY_SSM_TUNNEL_CONFIG,
  isSsmTunnelConfigComplete,
  tunnelSessionKey,
  type TunnelProgressPhase,
} from "./ssmTunnelTypes";
import {
  closeSsmTunnel,
  openSsmTunnelForConnect,
} from "./ssmTunnelService";
import {
  EMPTY_SSH_TUNNEL_CONFIG,
  isSshTunnelConfigComplete,
  type SshTunnelProgressPhase,
} from "./sshTunnelTypes";
import { closeSshTunnel, openSshTunnelForConnect } from "./sshTunnelService";
import { ConnectionPasswordPromptService } from "./connectionPasswordPromptService";

/** Accepts progress phases from either tunnel type — a connection uses at most one. */
export type ConnectProgress = (
  progress: TunnelProgressPhase | SshTunnelProgressPhase,
) => void;

type ConnectionListener = () => void;

const INITIAL_STATE: ConnectionState = {
  profiles: loadConnectionProfiles(),
  activeProfileId: loadActiveProfileId(),
  connectedProfileIds: [],
  connectingProfileIds: [],
  connectedProfileId: null,
  status: "disconnected",
  errorMessage: null,
};

class ConnectionServiceImpl {
  private state: ConnectionState = INITIAL_STATE;
  private readonly listeners = new Set<ConnectionListener>();
  private initPromise: Promise<void> | null = null;

  getState(): ConnectionState {
    return this.state;
  }

  getProfile(profileId: string): ConnectionProfile | undefined {
    return this.state.profiles.find((profile) => profile.id === profileId);
  }

  getActiveProfile(): ConnectionProfile | undefined {
    if (!this.state.activeProfileId) return undefined;
    return this.getProfile(this.state.activeProfileId);
  }

  /** Most recently connected profile (if still connected). */
  getConnectedProfile(): ConnectionProfile | undefined {
    if (!this.state.connectedProfileId) return undefined;
    if (!isProfileConnected(this.state, this.state.connectedProfileId)) {
      return undefined;
    }
    return this.getProfile(this.state.connectedProfileId);
  }

  getConnectedProfiles(): ConnectionProfile[] {
    return this.state.connectedProfileIds
      .map((id) => this.getProfile(id))
      .filter((profile): profile is ConnectionProfile => Boolean(profile));
  }

  /** True if any session is open, or if {@code profileId} is open when provided. */
  isConnected(profileId?: string): boolean {
    if (profileId) {
      return isProfileConnected(this.state, profileId);
    }
    return this.state.connectedProfileIds.length > 0;
  }

  /** True while {@code profileId} has a `connect()` in flight (tunnel + JDBC handshake). */
  isConnecting(profileId: string): boolean {
    return isProfileConnecting(this.state, profileId);
  }

  /**
   * One-time startup housekeeping (currently: migrating legacy plaintext passwords into the
   * OS credential store). Does *not* auto-connect anything — see
   * {@link connectFromRestoredTabs} for that, driven by which profiles the restored editor
   * tabs actually use. Safe to call from multiple places; every caller awaits the same
   * underlying migration.
   */
  initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.migrateLegacyPasswords();
    }
    return this.initPromise;
  }

  /**
   * Connects every distinct profile referenced by restored editor-tab bindings, silently and
   * in parallel — replaces the old "reconnect whatever was last active" startup behavior.
   * Profiles that no longer exist are skipped; a failed connect for one profile does not stop
   * the others (each `connect(..., { silent: true })` swallows its own error).
   */
  async connectFromRestoredTabs(profileIds: readonly string[]): Promise<void> {
    const ids = [...new Set(profileIds)].filter((id) => this.getProfile(id));
    await Promise.allSettled(ids.map((id) => this.connect(id, { silent: true })));
  }

  async getPassword(profileId: string): Promise<string> {
    return secretGet(profileId);
  }

  /**
   * @param options.savePassword Defaults to `true`. Pass `false` (the editor's "이 비밀번호
   * 저장" checkbox, unchecked) to leave the OS credential store untouched — `input.password`
   * is still used for an immediate Test/Connect in the same session, it just isn't persisted.
   */
  async createProfile(
    input: ConnectionProfileInput,
    options: { savePassword?: boolean } = {},
  ): Promise<ConnectionProfile> {
    const now = Date.now();
    const profile: ConnectionProfile = {
      id: crypto.randomUUID(),
      name: input.name.trim() || "New Connection",
      driverId: input.driverId,
      url: input.url.trim() || defaultUrlForDriver(input.driverId),
      user: input.user.trim(),
      password: "",
      catalog: input.catalog.trim(),
      defaultSchema: resolveDefaultSchema(input),
      showSystemObjects: input.showSystemObjects === true,
      ssmTunnel: input.ssmTunnel,
      sshTunnel: input.sshTunnel,
      createdAt: now,
      updatedAt: now,
    };

    if (options.savePassword !== false) {
      await secretSet(profile.id, input.password);
    }
    const profiles = [...this.state.profiles, profile];
    this.persistProfiles(profiles);
    this.setActiveProfile(profile.id);
    return profile;
  }

  /** See `createProfile`'s `options.savePassword` doc — same meaning here. */
  async updateProfile(
    profileId: string,
    input: ConnectionProfileInput,
    options: { savePassword?: boolean } = {},
  ): Promise<ConnectionProfile> {
    const profiles = this.state.profiles.map((profile) => {
      if (profile.id !== profileId) return profile;
      return {
        ...profile,
        name: input.name.trim() || profile.name,
        driverId: input.driverId,
        url: input.url.trim() || defaultUrlForDriver(input.driverId),
        user: input.user.trim(),
        password: "",
        catalog: input.catalog.trim(),
        defaultSchema: resolveDefaultSchema(input),
        showSystemObjects: input.showSystemObjects === true,
        ssmTunnel: input.ssmTunnel,
        sshTunnel: input.sshTunnel,
        updatedAt: Date.now(),
      };
    });

    const updated = profiles.find((profile) => profile.id === profileId);
    if (!updated) {
      throw new Error("Connection profile not found.");
    }

    if (options.savePassword !== false) {
      await secretSet(profileId, input.password);
    }
    this.persistProfiles(profiles);

    if (this.isConnected(profileId)) {
      await this.connect(profileId, { promptForPassword: false });
    }

    return updated;
  }

  /**
   * Persist the profile's default catalog/database without reconnecting.
   * Session catalog is unchanged — call ActiveDatabaseService.useDatabase if needed.
   */
  setDefaultCatalog(profileId: string, catalogName: string): ConnectionProfile {
    const catalog = catalogName.trim();
    const profiles = this.state.profiles.map((profile) => {
      if (profile.id !== profileId) return profile;
      if (profile.catalog.trim() === catalog) return profile;
      return {
        ...profile,
        catalog,
        updatedAt: Date.now(),
      };
    });

    const updated = profiles.find((profile) => profile.id === profileId);
    if (!updated) {
      throw new Error("Connection profile not found.");
    }

    this.persistProfiles(profiles);
    return updated;
  }

  async duplicateProfile(profileId: string): Promise<ConnectionProfile> {
    const source = this.getProfile(profileId);
    if (!source) {
      throw new Error("Connection profile not found.");
    }

    const password = await this.getPassword(profileId);
    return this.createProfile({
      name: `${source.name} (Copy)`,
      driverId: source.driverId,
      url: source.url,
      user: source.user,
      password,
      catalog: source.catalog,
      defaultSchema: source.defaultSchema,
      showSystemObjects: source.showSystemObjects,
      ssmTunnel: source.ssmTunnel ?? EMPTY_SSM_TUNNEL_CONFIG,
      sshTunnel: source.sshTunnel ?? EMPTY_SSH_TUNNEL_CONFIG,
    });
  }

  async deleteProfile(profileId: string): Promise<void> {
    const profiles = this.state.profiles.filter(
      (profile) => profile.id !== profileId,
    );
    this.persistProfiles(profiles);
    await secretDelete(profileId);
    ConnectionTreeService.invalidate(profileId);

    if (this.state.activeProfileId === profileId) {
      this.setActiveProfile(profiles[0]?.id ?? null);
    }

    if (this.isConnected(profileId)) {
      await this.disconnect(profileId);
    }
  }

  /**
   * Moves `profileId` to sit immediately before/after `targetProfileId` in the top-level list.
   * Profile order has no dedicated field — the array order in storage *is* the display order —
   * so this is just a splice-and-persist, same as every other mutation here.
   */
  reorderProfile(
    profileId: string,
    targetProfileId: string,
    position: "before" | "after",
  ): void {
    if (profileId === targetProfileId) return;
    const profiles = [...this.state.profiles];
    const fromIndex = profiles.findIndex((profile) => profile.id === profileId);
    if (fromIndex === -1) return;
    const [moved] = profiles.splice(fromIndex, 1);

    let targetIndex = profiles.findIndex((profile) => profile.id === targetProfileId);
    if (targetIndex === -1) {
      profiles.push(moved);
    } else {
      if (position === "after") targetIndex += 1;
      profiles.splice(targetIndex, 0, moved);
    }
    this.persistProfiles(profiles);
  }

  setActiveProfile(profileId: string | null): void {
    saveActiveProfileId(profileId);
    this.setState({
      ...this.state,
      activeProfileId: profileId,
    });
  }

  async connect(
    profileId: string,
    options: {
      silent?: boolean;
      onProgress?: ConnectProgress;
      /**
       * Set to `false` for connect calls that are a side effect of something else (e.g. the
       * editor reconnecting an already-connected profile right after Save) rather than the
       * user directly clicking Connect — those shouldn't interrupt the flow with a modal.
       * Defaults to `true` (prompt) whenever the connect isn't `silent`.
       */
      promptForPassword?: boolean;
    } = {},
  ): Promise<void> {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error("Connection profile not found.");
    }

    // Imported profiles never carry a password (see connectionExportService.ts) — rather than
    // let the connect attempt fail with a confusing DB-level auth error, ask for it up front.
    // Only for user-initiated connects: a silent auto-connect (app startup, running a query
    // against a disconnected profile) or a non-interactive reconnect (see `promptForPassword`
    // above) must not pop up a modal unprompted — it just fails as before.
    let password = await this.getPassword(profileId);
    if (!password && !options.silent && options.promptForPassword !== false) {
      const promptResult = await ConnectionPasswordPromptService.open(profile.name);
      if (!promptResult.confirmed) return;
      password = promptResult.password;
      if (promptResult.save) {
        await secretSet(profileId, password);
      }
    }

    this.setActiveProfile(profileId);
    this.setState({
      ...this.state,
      status: "connecting",
      errorMessage: null,
      connectingProfileIds: this.state.connectingProfileIds.includes(profileId)
        ? this.state.connectingProfileIds
        : [...this.state.connectingProfileIds, profileId],
    });

    const tunnel = profile.ssmTunnel;
    const tunnelEnabled = tunnel ? isSsmTunnelConfigComplete(tunnel) : false;
    const sshTunnel = profile.sshTunnel;
    const sshTunnelEnabled = sshTunnel ? isSshTunnelConfigComplete(sshTunnel) : false;
    if (tunnelEnabled && sshTunnelEnabled) {
      this.setState({
        ...this.state,
        connectingProfileIds: this.state.connectingProfileIds.filter(
          (id) => id !== profileId,
        ),
      });
      throw new Error("A connection can use only one tunnel type at a time.");
    }

    try {
      let effectiveUrl = profile.url;
      if (tunnelEnabled && tunnel) {
        effectiveUrl = await openSsmTunnelForConnect(
          profileId,
          profileId,
          profile.driverId,
          profile.url,
          tunnel,
          options.onProgress,
        );
      } else if (sshTunnelEnabled && sshTunnel) {
        effectiveUrl = await openSshTunnelForConnect(
          profileId,
          profile.driverId,
          profile.url,
          sshTunnel,
          options.onProgress,
        );
      }

      options.onProgress?.({ phase: "connectingDatabase" });
      await bridgeConnect(profileId, {
        url: effectiveUrl,
        user: profile.user,
        password,
        // Explicit Default Schema only — empty Oracle means session login schema (no ALTER).
        schema: profile.defaultSchema.trim() || undefined,
        catalog: profile.catalog.trim() || undefined,
      });

      ConnectionTreeService.invalidate(profileId);
      ConnectionTreeService.addConnectedProfile(profileId);
      ConnectionTreeService.setExplorerFilter(profileId, {
        driverId: profile.driverId,
        showSystemObjects: profile.showSystemObjects,
      });

      const connectedProfileIds = this.state.connectedProfileIds.includes(
        profileId,
      )
        ? this.state.connectedProfileIds
        : [...this.state.connectedProfileIds, profileId];

      this.setState({
        ...this.state,
        connectedProfileIds,
        connectingProfileIds: this.state.connectingProfileIds.filter(
          (id) => id !== profileId,
        ),
        connectedProfileId: profileId,
        status: "connected",
        errorMessage: null,
      });
      void ConnectionTreeService.loadSchemas(profileId, true).then(() =>
        this.preloadDefaultSchema(profileId),
      );
    } catch (error) {
      if (tunnelEnabled) {
        await closeSsmTunnel(profileId).catch(() => {});
      }
      if (sshTunnelEnabled) {
        await closeSshTunnel(profileId).catch(() => {});
      }
      const message = reportError(error, "connection.connect", "Failed to connect.");
      const stillConnected = this.state.connectedProfileIds.filter(
        (id) => id !== profileId,
      );
      this.setState({
        ...this.state,
        connectedProfileIds: stillConnected,
        connectingProfileIds: this.state.connectingProfileIds.filter(
          (id) => id !== profileId,
        ),
        connectedProfileId: stillConnected[stillConnected.length - 1] ?? null,
        status: stillConnected.length > 0 ? "connected" : "error",
        errorMessage: message,
      });
      if (!options.silent) {
        throw new Error(message);
      }
    }
  }

  private async preloadDefaultSchema(profileId: string): Promise<void> {
    if (
      !ConfigurationService.getValue("database.explorer.preloadDefaultSchema")
    ) {
      return;
    }
    if (!this.isConnected(profileId)) {
      return;
    }

    const profile = this.getProfile(profileId);
    const cache = ConnectionTreeService.getCache(profileId);

    try {
      if (cache.catalogs.length > 0) {
        const catalogName =
          cache.currentCatalog?.trim() ||
          profile?.catalog.trim() ||
          cache.catalogs[0]?.name;
        if (!catalogName) return;
        await ConnectionTreeService.loadCatalogSchemas(profileId, catalogName);
        if (!this.isConnected(profileId)) return;

        const schemaName = profile ? effectiveDefaultSchema(profile) : "";
        if (schemaName) {
          await ConnectionTreeService.loadSchemaObjects(
            profileId,
            schemaName,
            false,
            catalogName,
          );
        }
        return;
      }

      const schemaName = profile ? effectiveDefaultSchema(profile) : "";
      if (!schemaName) {
        return;
      }

      await ConnectionTreeService.loadSchemaObjects(profileId, schemaName);
    } catch (error) {
      console.warn(
        "[silk.connection] failed to preload default schema",
        profile ? effectiveDefaultSchema(profile) : "",
        error,
      );
    }
  }

  /**
   * Disconnect one profile, or the most recent connected profile when omitted.
   * Other open sessions stay connected.
   */
  async disconnect(profileId?: string): Promise<void> {
    const targetId =
      profileId ??
      this.state.connectedProfileId ??
      this.state.connectedProfileIds[
        this.state.connectedProfileIds.length - 1
      ] ??
      null;
    if (!targetId) {
      this.setState({
        ...this.state,
        connectedProfileIds: [],
        connectedProfileId: null,
        status: "disconnected",
        errorMessage: null,
      });
      return;
    }

    try {
      if (this.isConnected(targetId)) {
        await bridgeDisconnect(targetId);
      }
    } finally {
      await closeSsmTunnel(targetId).catch(() => {});
      await closeSshTunnel(targetId).catch(() => {});
      ConnectionTreeService.removeConnectedProfile(targetId);
      ConnectionTreeService.invalidate(targetId);
      const connectedProfileIds = this.state.connectedProfileIds.filter(
        (id) => id !== targetId,
      );
      this.setState({
        ...this.state,
        connectedProfileIds,
        connectedProfileId:
          connectedProfileIds[connectedProfileIds.length - 1] ?? null,
        status: connectedProfileIds.length > 0 ? "connected" : "disconnected",
        errorMessage: null,
      });
    }
  }

  async testProfile(profileId: string): Promise<void> {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error("Connection profile not found.");
    }

    const password = await this.getPassword(profileId);
    await this.testCredentials(
      {
        name: profile.name,
        driverId: profile.driverId,
        url: profile.url,
        user: profile.user,
        password,
        catalog: profile.catalog,
        defaultSchema: profile.defaultSchema,
        showSystemObjects: profile.showSystemObjects,
        ssmTunnel: profile.ssmTunnel ?? EMPTY_SSM_TUNNEL_CONFIG,
        sshTunnel: profile.sshTunnel ?? EMPTY_SSH_TUNNEL_CONFIG,
      },
      { profileId },
    );
  }

  /**
   * `profileId` is only available for an already-saved profile (the editor's Test button also
   * calls this before the profile has ever been saved, i.e. before an id exists) — when
   * omitted, a stable key derived from the tunnel's own SSO config is used instead, so
   * repeated test clicks while still editing a new profile reuse the same cached SSO session
   * rather than forcing a fresh browser login every time.
   */
  async testCredentials(
    input: ConnectionProfileInput,
    options: { profileId?: string; onProgress?: ConnectProgress } = {},
  ): Promise<void> {
    const tunnel = input.ssmTunnel;
    const tunnelEnabled = isSsmTunnelConfigComplete(tunnel);
    const sshTunnel = input.sshTunnel;
    const sshTunnelEnabled = isSshTunnelConfigComplete(sshTunnel);
    if (tunnelEnabled && sshTunnelEnabled) {
      throw new Error("A connection can use only one tunnel type at a time.");
    }

    if (!tunnelEnabled && !sshTunnelEnabled) {
      options.onProgress?.({ phase: "connectingDatabase" });
      await bridgeTestConnection(this.toCredentials(input));
      return;
    }

    // No profile id yet for a not-yet-saved profile being edited — fall back to a stable
    // per-tunnel-type key so repeated Test clicks reuse the same cached session/tunnel slot.
    const tunnelKey = tunnelEnabled
      ? tunnelSessionKey(options.profileId, tunnel)
      : (options.profileId ?? "pending-ssh");

    const tunnelUrl = tunnelEnabled
      ? await openSsmTunnelForConnect(
          tunnelKey,
          tunnelKey,
          input.driverId,
          input.url.trim() || defaultUrlForDriver(input.driverId),
          tunnel,
          options.onProgress,
        )
      : await openSshTunnelForConnect(
          tunnelKey,
          input.driverId,
          input.url.trim() || defaultUrlForDriver(input.driverId),
          sshTunnel,
          options.onProgress,
        );
    try {
      options.onProgress?.({ phase: "connectingDatabase" });
      await bridgeTestConnection(this.toCredentials({ ...input, url: tunnelUrl }));
    } finally {
      if (tunnelEnabled) {
        await closeSsmTunnel(tunnelKey).catch(() => {});
      } else {
        await closeSshTunnel(tunnelKey).catch(() => {});
      }
    }
  }

  private toCredentials(
    input: Pick<
      ConnectionProfileInput,
      "driverId" | "url" | "user" | "password" | "catalog" | "defaultSchema"
    >,
  ) {
    return {
      url: input.url.trim() || defaultUrlForDriver(input.driverId),
      user: input.user.trim(),
      password: input.password,
      schema: resolveDefaultSchema(input) || undefined,
      catalog: input.catalog.trim() || undefined,
    };
  }

  private async migrateLegacyPasswords(): Promise<void> {
    const legacy = extractLegacyPasswords(this.state.profiles);
    if (legacy.length === 0) return;

    for (const item of legacy) {
      await secretSet(item.profileId, item.password);
    }

    // Rewrite localStorage without password fields.
    this.persistProfiles(this.state.profiles);
  }

  onDidChange(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persistProfiles(profiles: ConnectionProfile[]): void {
    saveConnectionProfiles(profiles);
    this.setState({
      ...this.state,
      profiles,
    });
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const ConnectionService = new ConnectionServiceImpl();

/**
 * For drivers without an independent schema concept (e.g. MySQL, where a "database" is both
 * the catalog and the only browsable namespace), keep `defaultSchema` mirroring `catalog` so
 * the Explorer's existing default-schema highlighting keeps working without driver-specific
 * cases outside this service.
 */
function resolveDefaultSchema(
  input: Pick<ConnectionProfileInput, "driverId" | "catalog" | "defaultSchema">,
): string {
  const driver = getConnectionDriver(input.driverId);
  return driver.showSchemaField ? input.defaultSchema.trim() : input.catalog.trim();
}
