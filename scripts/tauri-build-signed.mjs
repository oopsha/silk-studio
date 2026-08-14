#!/usr/bin/env node
/**
 * Runs `tauri build`, auto-loading the updater signing key from
 * `.secrets/tauri-updater.key` (gitignored, see docs/release.md) into
 * TAURI_SIGNING_PRIVATE_KEY so it doesn't have to be set by hand every time.
 *
 * Falls back to an unsigned build (with a warning) if no key is found and
 * TAURI_SIGNING_PRIVATE_KEY isn't already set in the environment.
 *
 * Usage: node scripts/tauri-build-signed.mjs [extra tauri build args...]
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const APP_DIR = join(REPO_ROOT, "apps", "silk-db-studio");
const KEY_PATH = join(REPO_ROOT, ".secrets", "tauri-updater.key");
const KEY_PASSWORD_PATH = join(REPO_ROOT, ".secrets", "tauri-updater.key.password");

const env = { ...process.env };

if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  if (existsSync(KEY_PATH)) {
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(KEY_PATH, "utf8");
    // The key is always minisign/rsign-"encrypted", even with an empty passphrase. If this
    // var is left unset, tauri's signer prompts interactively for a password on stdin — which
    // hangs forever under a non-interactive spawn like this one (see stdio below for the
    // fail-fast backstop). Read the passphrase from a sibling gitignored file if present,
    // otherwise default to empty.
    if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
      env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = existsSync(KEY_PASSWORD_PATH)
        ? readFileSync(KEY_PASSWORD_PATH, "utf8").replace(/\r?\n$/, "")
        : "";
    }
    console.log("[tauri-build] Loaded updater signing key from .secrets/tauri-updater.key");
  } else {
    console.warn(
      `[tauri-build] No TAURI_SIGNING_PRIVATE_KEY set and ${KEY_PATH} not found — ` +
        "updater .sig files will not be created. See docs/release.md.",
    );
  }
}

const result = spawnSync(
  "pnpm",
  ["exec", "tauri", "build", ...process.argv.slice(2)],
  {
    cwd: APP_DIR,
    env,
    // stdin "ignore" (not "inherit"): if anything ever tries to prompt interactively despite
    // the safeguard above, it gets immediate EOF and fails fast instead of hanging forever.
    stdio: ["ignore", "inherit", "inherit"],
    shell: true,
  },
);

process.exit(result.status ?? 1);
