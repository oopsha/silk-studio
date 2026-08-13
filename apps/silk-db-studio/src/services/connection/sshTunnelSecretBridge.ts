import { secretDelete, secretGet, secretSet } from "./connectionSecretBridge";

export type SshSecretKind = "password" | "passphrase";

/**
 * Reuses the existing OS-keyring-backed `secretSet/Get/Delete` (same store as the DB password)
 * by folding the SSH secret's purpose into a composite key, rather than adding a new Rust
 * command/keyring account scheme. `secrets.rs`'s `entry_for_profile` just formats
 * `profile:{profile_id}` verbatim, so this composite string arrives as-is on the Rust side —
 * zero backend changes needed.
 */
function compositeKey(connectionId: string, kind: SshSecretKind): string {
  return `${connectionId}:ssh-${kind}`;
}

export async function sshSecretSet(
  connectionId: string,
  kind: SshSecretKind,
  value: string,
): Promise<void> {
  await secretSet(compositeKey(connectionId, kind), value);
}

export async function sshSecretGet(connectionId: string, kind: SshSecretKind): Promise<string> {
  return secretGet(compositeKey(connectionId, kind));
}

export async function sshSecretDelete(connectionId: string, kind: SshSecretKind): Promise<void> {
  await secretDelete(compositeKey(connectionId, kind));
}
