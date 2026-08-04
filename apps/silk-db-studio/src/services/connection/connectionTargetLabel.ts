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
  const schema =
    binding.schema?.trim() ||
    (profile ? effectiveDefaultSchema(profile) : "") ||
    "";
  const connected = ConnectionService.isConnected(binding.profileId);

  if (!connected) {
    return labels.disconnected.replace("{name}", name);
  }

  return schema ? `${name} › ${schema}` : name;
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
