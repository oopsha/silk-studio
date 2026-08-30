import { ConnectionService } from "../../services/connection/connectionService";
import type { EditorConnectionBinding } from "../../services/connection/editorConnectionBindingService";
import { effectiveDefaultSchema } from "../../services/connection/connectionTypes";

export function formatConnectionTargetLabel(
  binding: EditorConnectionBinding,
  labels: {
    noConnection: string;
    disconnected: string;
  },
): string {
  if (!binding.profileId) {
    return labels.noConnection;
  }

  const profile = ConnectionService.getProfile(binding.profileId);
  const name = profile?.name?.trim() || binding.profileId;
  const catalog =
    binding.catalog?.trim() ||
    profile?.catalog.trim() ||
    "";
  const schema =
    binding.schema?.trim() ||
    (profile ? effectiveDefaultSchema(profile) : "") ||
    "";
  const connected = ConnectionService.isConnected(binding.profileId);

  if (!connected) {
    return labels.disconnected.replace("{name}", name);
  }

  if (catalog && schema) {
    return `${name} › ${catalog} › ${schema}`;
  }
  if (catalog) {
    return `${name} › ${catalog}`;
  }
  return schema ? `${name} › ${schema}` : name;
}

/** Connection-only status bar label — profile name, no catalog/schema. */
export function formatConnectionNameLabel(
  binding: EditorConnectionBinding,
  labels: {
    noConnection: string;
    disconnected: string;
  },
): string {
  if (!binding.profileId) {
    return labels.noConnection;
  }

  const profile = ConnectionService.getProfile(binding.profileId);
  const name = profile?.name?.trim() || binding.profileId;
  const connected = ConnectionService.isConnected(binding.profileId);

  return connected ? name : labels.disconnected.replace("{name}", name);
}

/** Database (catalog) status bar label for the currently bound profile. */
export function formatDatabaseLabel(
  binding: EditorConnectionBinding,
  noDatabaseLabel: string,
): string {
  if (!binding.profileId) return noDatabaseLabel;
  const profile = ConnectionService.getProfile(binding.profileId);
  const catalog = binding.catalog?.trim() || profile?.catalog.trim() || "";
  return catalog || noDatabaseLabel;
}

/** Schema status bar label for the currently bound profile (Oracle/PostgreSQL). */
export function formatSchemaLabel(
  binding: EditorConnectionBinding,
  noSchemaLabel: string,
): string {
  if (!binding.profileId) return noSchemaLabel;
  const profile = ConnectionService.getProfile(binding.profileId);
  const schema =
    binding.schema?.trim() ||
    (profile ? effectiveDefaultSchema(profile) : "") ||
    "";
  return schema || noSchemaLabel;
}

/** Short muted tab suffix — profile name only (truncated). */
export function formatConnectionTabSuffix(
  binding: EditorConnectionBinding,
): string | null {
  if (!binding.profileId) return null;
  const profile = ConnectionService.getProfile(binding.profileId);
  const name = profile?.name?.trim() || binding.profileId;
  const connected = ConnectionService.isConnected(binding.profileId);
  const short = name.length > 16 ? `${name.slice(0, 15)}…` : name;
  return connected ? short : `!${short}`;
}

export function bindingForProfile(profileId: string): EditorConnectionBinding {
  const profile = ConnectionService.getProfile(profileId);
  if (!profile) {
    return { profileId, catalog: null, schema: null };
  }
  return {
    profileId,
    catalog: profile.catalog.trim() || null,
    schema: effectiveDefaultSchema(profile) || null,
  };
}
