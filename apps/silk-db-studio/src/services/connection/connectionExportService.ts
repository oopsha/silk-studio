import { open as openFilePicker, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ConnectionService } from "./connectionService";
import { isKnownDriverId, type StoredConnectionProfile } from "./connectionStorage";
import { getConnectionDriver, type ConnectionDriverId, type ConnectionProfileInput } from "./connectionTypes";
import { parseJdbcUrl } from "./connectionUrlBuilder";
import { normalizeSsmTunnelConfig } from "./ssmTunnelTypes";
import { normalizeSshTunnelConfig } from "./sshTunnelTypes";
import {
  ConnectionImportDialogService,
  type ConnectionImportCandidate,
} from "./connectionImportDialogService";

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }];

type ConnectionExportFile = {
  formatVersion: 1;
  exportedAt: string;
  profiles: StoredConnectionProfile[];
};

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Writes connection profiles to a JSON file, minus secrets — the mapped object literal below
 * has no `password` field at all, so there's nothing to accidentally leak even if the
 * in-memory `password: ""` invariant (see `connectionService.ts`) were ever violated.
 *
 * @param profileIds When given, only these profiles are exported (the "개별 선택" path from
 * `ConnectionExportDialog`); omitted/undefined exports every profile.
 * Returns `false` if there's nothing to export or the user cancels the save dialog.
 */
export async function exportConnectionProfiles(
  profileIds?: string[],
): Promise<boolean> {
  const { profiles: allProfiles } = ConnectionService.getState();
  const profiles = profileIds
    ? allProfiles.filter((profile) => profileIds.includes(profile.id))
    : allProfiles;
  if (profiles.length === 0) return false;

  const stored: StoredConnectionProfile[] = profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    driverId: profile.driverId,
    url: profile.url,
    user: profile.user,
    catalog: profile.catalog,
    defaultSchema: profile.defaultSchema,
    showSystemObjects: profile.showSystemObjects,
    ssmTunnel: profile.ssmTunnel,
    sshTunnel: profile.sshTunnel,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }));

  const payload: ConnectionExportFile = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    profiles: stored,
  };

  const path = await save({
    defaultPath: `silk-connections-${formatTimestamp(new Date())}.json`,
    filters: JSON_FILTER,
  });
  if (!path) return false;

  await writeTextFile(path, JSON.stringify(payload, null, 2));
  return true;
}

export type ConnectionImportResult = {
  imported: number;
  skipped: number;
};

/**
 * Reads a connections export file, lets the user review/select which valid records to import
 * via `ConnectionImportDialogService` (showing name/driver/host/database/tunnel plus name- and
 * connection-info-duplicate flags against existing profiles), then adds only the selected ones
 * as brand-new profiles (fresh id/timestamps via `ConnectionService.createProfile`, never
 * trusting the file's own `id`). Never merges/overwrites existing profiles — a name/connection
 * match is shown as a hint, not a block. A malformed individual record is dropped before the
 * dialog even opens (mirrors `connectionStorage.ts`'s own defensive filtering) and counted in
 * `skipped`, same as a record that fails to create for some other reason.
 * Returns `null` if the user cancels the file picker or the selection dialog.
 */
export async function importConnectionProfiles(): Promise<ConnectionImportResult | null> {
  const path = await openFilePicker({ multiple: false, directory: false, filters: JSON_FILTER });
  if (typeof path !== "string") return null;

  let raw: string;
  try {
    raw = await readTextFile(path);
  } catch {
    throw new Error("Could not read the selected file.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).formatVersion !== 1 ||
    !Array.isArray((parsed as Record<string, unknown>).profiles)
  ) {
    throw new Error("The selected file is not a valid connections export.");
  }

  const rawRecords = (parsed as ConnectionExportFile).profiles;
  const { records, skipped: invalidSkipped } = buildImportRecords(rawRecords);
  if (records.length === 0) {
    return { imported: 0, skipped: invalidSkipped };
  }

  const dialogResult = await ConnectionImportDialogService.open(
    records.map((record) => record.candidate),
  );
  if (!dialogResult.confirmed) return null;

  const selectedIndexes = new Set(dialogResult.indexes);
  let imported = 0;
  let skipped = invalidSkipped;

  for (const record of records) {
    if (!selectedIndexes.has(record.candidate.index)) continue;
    try {
      await ConnectionService.createProfile(record.input);
      imported++;
    } catch {
      skipped++;
    }
  }

  return { imported, skipped };
}

type ConnectionImportRecord = {
  candidate: ConnectionImportCandidate;
  input: ConnectionProfileInput;
};

/**
 * A stable, order/case-insensitive key identifying "the same connection target" — driver +
 * host + port + user + database + tunnel kind. Tunnel kind is part of the key because two
 * profiles pointing at the same host/db but one going through SSM/SSH and the other connecting
 * directly are meaningfully different setups, not duplicates (e.g. one may only be reachable
 * through the tunnel at all). `null` when the URL can't be parsed structurally (a raw/custom
 * URL), in which case we simply can't tell and don't flag a connection-info conflict for it (a
 * false negative here is far safer than a false positive).
 */
function connectionMatchKey(
  driverId: ConnectionDriverId,
  url: string,
  user: string,
  tunnel: "none" | "ssm" | "ssh",
): string | null {
  const parsed = parseJdbcUrl(driverId, url);
  if (!parsed) return null;
  return [
    driverId,
    parsed.host.trim().toLowerCase(),
    parsed.port.trim(),
    user.trim().toLowerCase(),
    parsed.database.trim().toLowerCase(),
    tunnel,
  ].join("|");
}

function tunnelKindOf(profile: { ssmTunnel?: { enabled: boolean }; sshTunnel?: { enabled: boolean } }): "none" | "ssm" | "ssh" {
  if (profile.sshTunnel?.enabled) return "ssh";
  if (profile.ssmTunnel?.enabled) return "ssm";
  return "none";
}

function buildImportRecords(rawRecords: unknown[]): {
  records: ConnectionImportRecord[];
  skipped: number;
} {
  const existingProfiles = ConnectionService.getState().profiles;
  const existingNames = new Set(
    existingProfiles.map((profile) => profile.name.trim().toLowerCase()),
  );
  const existingKeys = new Set(
    existingProfiles
      .map((profile) =>
        connectionMatchKey(profile.driverId, profile.url, profile.user, tunnelKindOf(profile)),
      )
      .filter((key): key is string => key !== null),
  );

  const records: ConnectionImportRecord[] = [];
  let skipped = 0;

  rawRecords.forEach((raw, index) => {
    const input = normalizeImportedProfile(raw);
    if (!input) {
      skipped++;
      return;
    }

    const parsedUrl = parseJdbcUrl(input.driverId, input.url);
    const tunnel = tunnelKindOf(input);
    const key = connectionMatchKey(input.driverId, input.url, input.user, tunnel);

    records.push({
      input,
      candidate: {
        index,
        name: input.name,
        driverLabel: getConnectionDriver(input.driverId).label,
        hostPort: parsedUrl ? `${parsedUrl.host}:${parsedUrl.port}` : input.url,
        database: parsedUrl ? parsedUrl.database : "",
        user: input.user,
        tunnel,
        nameConflict: existingNames.has(input.name.trim().toLowerCase()),
        connectionConflict: key !== null && existingKeys.has(key),
      },
    });
  });

  return { records, skipped };
}

function normalizeImportedProfile(value: unknown): ConnectionProfileInput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.name !== "string" ||
    !isKnownDriverId(record.driverId) ||
    typeof record.url !== "string" ||
    typeof record.user !== "string"
  ) {
    return null;
  }

  return {
    name: record.name,
    driverId: record.driverId,
    url: record.url,
    user: record.user,
    // Imported profiles never carry a password — the export never wrote one either.
    password: "",
    catalog: typeof record.catalog === "string" ? record.catalog : "",
    defaultSchema: typeof record.defaultSchema === "string" ? record.defaultSchema : "",
    showSystemObjects: record.showSystemObjects === true,
    ssmTunnel: normalizeSsmTunnelConfig(record.ssmTunnel),
    sshTunnel: normalizeSshTunnelConfig(record.sshTunnel),
  };
}
