import type { ConnectionDriverId, ConnectionProfile } from "./connectionTypes";
import { CONNECTION_DRIVERS } from "./connectionTypes";

const PROFILES_KEY = "silk-db-studio.connection.profiles";
const ACTIVE_PROFILE_KEY = "silk-db-studio.connection.activeProfileId";

const KNOWN_DRIVER_IDS = new Set<string>(
  CONNECTION_DRIVERS.map((driver) => driver.id),
);

function isKnownDriverId(value: unknown): value is ConnectionDriverId {
  return typeof value === "string" && KNOWN_DRIVER_IDS.has(value);
}

/** Persisted shape — passwords live in the OS credential store, not here. */
export type StoredConnectionProfile = {
  id: string;
  name: string;
  driverId: ConnectionDriverId;
  url: string;
  user: string;
  catalog?: string;
  defaultSchema?: string;
  createdAt: number;
  updatedAt: number;
};

export function loadConnectionProfiles(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeStoredProfile)
      .filter((profile): profile is ConnectionProfile => profile !== null);
  } catch {
    return [];
  }
}

export function saveConnectionProfiles(profiles: ConnectionProfile[]): void {
  const stored: StoredConnectionProfile[] = profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    driverId: profile.driverId,
    url: profile.url,
    user: profile.user,
    catalog: profile.catalog,
    defaultSchema: profile.defaultSchema,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }));
  localStorage.setItem(PROFILES_KEY, JSON.stringify(stored));
}

export function loadActiveProfileId(): string | null {
  const value = localStorage.getItem(ACTIVE_PROFILE_KEY);
  return value && value.length > 0 ? value : null;
}

export function saveActiveProfileId(profileId: string | null): void {
  if (!profileId) {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
}

/**
 * Profiles that still have a plaintext password in localStorage (pre-3-B).
 * Returns id → password pairs that should be migrated to the OS store.
 */
export function extractLegacyPasswords(
  profiles: ConnectionProfile[],
): Array<{ profileId: string; password: string }> {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];

    const result: Array<{ profileId: string; password: string }> = [];
    for (const record of parsed) {
      if (
        typeof record.id === "string" &&
        typeof record.password === "string" &&
        record.password.length > 0
      ) {
        result.push({ profileId: record.id, password: record.password });
      }
    }

    // Ensure we only migrate ids that still exist as profiles.
    const ids = new Set(profiles.map((profile) => profile.id));
    return result.filter((item) => ids.has(item.profileId));
  } catch {
    return [];
  }
}

function normalizeStoredProfile(value: unknown): ConnectionProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    !isKnownDriverId(record.driverId) ||
    typeof record.url !== "string" ||
    typeof record.user !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.updatedAt !== "number"
  ) {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    driverId: record.driverId,
    url: record.url,
    user: record.user,
    // Never keep passwords from localStorage in memory after migration.
    password: "",
    catalog: typeof record.catalog === "string" ? record.catalog : "",
    defaultSchema:
      typeof record.defaultSchema === "string" ? record.defaultSchema : "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
