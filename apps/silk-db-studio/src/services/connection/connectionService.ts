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
import { defaultUrlForDriver, getConnectionDriver } from "./connectionTypes";
import { formatErrorMessage } from "../formatErrorMessage";
import { ConnectionTreeService } from "./connectionTreeService";

type ConnectionListener = () => void;

const INITIAL_STATE: ConnectionState = {
  profiles: loadConnectionProfiles(),
  activeProfileId: loadActiveProfileId(),
  connectedProfileId: null,
  status: "disconnected",
  errorMessage: null,
};

class ConnectionServiceImpl {
  private state: ConnectionState = INITIAL_STATE;
  private readonly listeners = new Set<ConnectionListener>();
  private initialized = false;

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

  getConnectedProfile(): ConnectionProfile | undefined {
    if (!this.state.connectedProfileId) return undefined;
    return this.getProfile(this.state.connectedProfileId);
  }

  isConnected(): boolean {
    return this.state.status === "connected";
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.migrateLegacyPasswords();

    const activeProfile = this.getActiveProfile();
    if (activeProfile) {
      await this.connect(activeProfile.id, { silent: true });
    }
  }

  async getPassword(profileId: string): Promise<string> {
    return secretGet(profileId);
  }

  async createProfile(
    input: ConnectionProfileInput,
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
      createdAt: now,
      updatedAt: now,
    };

    await secretSet(profile.id, input.password);
    const profiles = [...this.state.profiles, profile];
    this.persistProfiles(profiles);
    this.setActiveProfile(profile.id);
    return profile;
  }

  async updateProfile(
    profileId: string,
    input: ConnectionProfileInput,
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
        updatedAt: Date.now(),
      };
    });

    const updated = profiles.find((profile) => profile.id === profileId);
    if (!updated) {
      throw new Error("Connection profile not found.");
    }

    await secretSet(profileId, input.password);
    this.persistProfiles(profiles);

    if (this.state.connectedProfileId === profileId) {
      await this.connect(profileId);
    }

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

    if (this.state.connectedProfileId === profileId) {
      await this.disconnect();
    }
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
    options: { silent?: boolean } = {},
  ): Promise<void> {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error("Connection profile not found.");
    }

    this.setActiveProfile(profileId);
    this.setState({
      ...this.state,
      status: "connecting",
      errorMessage: null,
    });

    try {
      if (
        this.state.connectedProfileId &&
        this.state.connectedProfileId !== profileId
      ) {
        await bridgeDisconnect();
      }

      const password = await this.getPassword(profileId);
      await bridgeConnect({
        url: profile.url,
        user: profile.user,
        password,
        schema: profile.defaultSchema.trim() || undefined,
        catalog: profile.catalog.trim() || undefined,
      });

      ConnectionTreeService.invalidate();
      ConnectionTreeService.setConnectedProfileId(profileId);
      this.setState({
        ...this.state,
        connectedProfileId: profileId,
        status: "connected",
        errorMessage: null,
      });
      void ConnectionTreeService.loadSchemas(profileId, true);
    } catch (error) {
      const message = formatErrorMessage(error, "Failed to connect.");
      ConnectionTreeService.setConnectedProfileId(null);
      this.setState({
        ...this.state,
        connectedProfileId: null,
        status: "error",
        errorMessage: message,
      });
      if (!options.silent) {
        throw new Error(message);
      }
    }
  }

  async disconnect(): Promise<void> {
    try {
      await bridgeDisconnect();
    } finally {
      ConnectionTreeService.invalidate();
      ConnectionTreeService.setConnectedProfileId(null);
      this.setState({
        ...this.state,
        connectedProfileId: null,
        status: "disconnected",
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
    await this.testCredentials({
      name: profile.name,
      driverId: profile.driverId,
      url: profile.url,
      user: profile.user,
      password,
      catalog: profile.catalog,
      defaultSchema: profile.defaultSchema,
    });
  }

  async testCredentials(input: ConnectionProfileInput): Promise<void> {
    await bridgeTestConnection(this.toCredentials(input));
  }

  private toCredentials(
    input: Pick<
      ConnectionProfileInput,
      "driverId" | "url" | "user" | "password" | "catalog"
    >,
  ) {
    return {
      url: input.url.trim() || defaultUrlForDriver(input.driverId),
      user: input.user.trim(),
      password: input.password,
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
function resolveDefaultSchema(input: ConnectionProfileInput): string {
  const driver = getConnectionDriver(input.driverId);
  return driver.showSchemaField ? input.defaultSchema.trim() : input.catalog.trim();
}
