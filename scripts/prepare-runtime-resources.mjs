#!/usr/bin/env node
/**
 * Stage jdbc-agent + Eclipse Temurin JRE 17 into
 * apps/silk-db-studio/src-tauri/resources/ for Tauri bundling.
 *
 * Usage (from repo root or apps/silk-db-studio):
 *   node scripts/prepare-runtime-resources.mjs
 *   node scripts/prepare-runtime-resources.mjs --skip-jre   # agent only
 *   node scripts/prepare-runtime-resources.mjs --force-jre  # re-download JRE
 *
 * Env overrides:
 *   SILK_JRE_OS=mac|windows|linux
 *   SILK_JRE_ARCH=x64|aarch64
 *
 * NOTE: the AWS session-manager-plugin binary used by the SSM tunnel feature is NOT staged
 * here yet — see the comment above stageSsmPlugin() below for why (AWS only distributes it
 * via an installer that requires Administrator rights, unlike the plain JRE archive).
 */

import { createWriteStream } from "node:fs";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const AGENT_PKG = join(REPO_ROOT, "packages", "jdbc-agent");
const AGENT_LIBS = join(AGENT_PKG, "build", "libs");
const AGENT_JAR = join(AGENT_LIBS, "jdbc-agent-all.jar");
const AGENT_LIB_DIR = join(AGENT_LIBS, "lib");
const RESOURCES = join(
  REPO_ROOT,
  "apps",
  "silk-db-studio",
  "src-tauri",
  "resources",
);
const OUT_AGENT = join(RESOURCES, "jdbc-agent");
const OUT_JRE = join(RESOURCES, "jre");
const OUT_SSM_PLUGIN = join(RESOURCES, "ssm-plugin");

const args = new Set(process.argv.slice(2));
const skipJre = args.has("--skip-jre");
const forceJre = args.has("--force-jre");

function log(message) {
  console.log(`[prepare-runtime] ${message}`);
}

function fail(message) {
  console.error(`[prepare-runtime] ERROR: ${message}`);
  process.exit(1);
}

function detectOs() {
  if (process.env.SILK_JRE_OS) return process.env.SILK_JRE_OS;
  switch (process.platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      fail(`Unsupported platform: ${process.platform}`);
  }
}

function detectArch() {
  if (process.env.SILK_JRE_ARCH) return process.env.SILK_JRE_ARCH;
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "aarch64";
    default:
      fail(`Unsupported arch: ${process.arch}`);
  }
}

function ensureAgentBuilt() {
  if (existsSync(AGENT_JAR) && existsSync(AGENT_LIB_DIR)) {
    log(`jdbc-agent already built: ${AGENT_JAR}`);
    return;
  }
  log("Building jdbc-agent via Gradle…");
  const isWin = process.platform === "win32";
  const gradlew = join(AGENT_PKG, isWin ? "gradlew.bat" : "gradlew");
  execFileSync(gradlew, ["build", "--quiet"], {
    cwd: AGENT_PKG,
    stdio: "inherit",
    shell: isWin,
  });
  if (!existsSync(AGENT_JAR)) {
    fail(`Expected jar missing after build: ${AGENT_JAR}`);
  }
}

function stageAgent() {
  ensureAgentBuilt();
  rmSync(OUT_AGENT, { recursive: true, force: true });
  mkdirSync(OUT_AGENT, { recursive: true });
  cpSync(AGENT_JAR, join(OUT_AGENT, "jdbc-agent-all.jar"));
  cpSync(AGENT_LIB_DIR, join(OUT_AGENT, "lib"), { recursive: true });
  cpSync(
    join(AGENT_PKG, "THIRD_PARTY_NOTICES.md"),
    join(OUT_AGENT, "THIRD_PARTY_NOTICES.md"),
  );
  log(`Staged jdbc-agent → ${OUT_AGENT}`);
}

function javaBinExists(jreRoot) {
  const win = join(jreRoot, "bin", "java.exe");
  const unix = join(jreRoot, "bin", "java");
  return existsSync(win) || existsSync(unix);
}

/**
 * Temurin ships some files (e.g. *.jsa) as mode 0444. Tauri copies them into
 * the cargo target resources tree preserving that mode; the next rebuild then
 * fails to overwrite with EPERM. Ensure the staged tree is owner-writable first.
 */
function ensureTreeWritable(root) {
  if (!existsSync(root)) return;

  function walk(path) {
    const st = statSync(path);
    try {
      chmodSync(path, st.mode | 0o200);
    } catch (error) {
      // Best-effort: continue so one locked leaf does not abort staging.
      log(`warn: chmod failed for ${path}: ${error}`);
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(path)) {
        walk(join(path, name));
      }
    }
  }

  walk(root);
  log(`Ensured owner-writable permissions under ${root}`);
}

function findExtractedHome(root) {
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (javaBinExists(dir)) return dir;
    // macOS Adoptium layout
    const macHome = join(dir, "Contents", "Home");
    if (javaBinExists(macHome)) return macHome;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(join(dir, entry.name));
      }
    }
  }
  return null;
}

async function download(url, dest) {
  log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    fail(`Download failed (${response.status}): ${url}`);
  }
  await pipeline(response.body, createWriteStream(dest));
  const size = statSync(dest).size;
  log(`Downloaded ${(size / (1024 * 1024)).toFixed(1)} MiB → ${dest}`);
}

function extractArchive(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
        ],
        { stdio: "inherit" },
      );
    } else {
      execFileSync("unzip", ["-q", archivePath, "-d", destDir], {
        stdio: "inherit",
      });
    }
    return;
  }

  // .tar.gz
  execFileSync("tar", ["-xzf", archivePath, "-C", destDir], {
    stdio: "inherit",
  });
}

async function stageJre() {
  if (!forceJre && javaBinExists(OUT_JRE)) {
    log(`Bundled JRE already present: ${OUT_JRE}`);
    ensureTreeWritable(OUT_JRE);
    return;
  }

  const os = detectOs();
  const arch = detectArch();
  // Eclipse Temurin JRE 17 (Hotspot) — GPLv2 + Classpath Exception.
  const url =
    `https://api.adoptium.net/v3/binary/latest/17/ga/${os}/${arch}/jre/hotspot/normal/eclipse?project=jdk`;

  const tmp = mkdtempSync(join(tmpdir(), "silk-jre-"));
  try {
    const archiveName =
      os === "windows" ? "temurin-jre-17.zip" : "temurin-jre-17.tar.gz";
    const archivePath = join(tmp, archiveName);
    await download(url, archivePath);

    const extractRoot = join(tmp, "extract");
    extractArchive(archivePath, extractRoot);
    const home = findExtractedHome(extractRoot);
    if (!home) {
      fail("Could not locate bin/java inside downloaded JRE archive.");
    }

    rmSync(OUT_JRE, { recursive: true, force: true });
    mkdirSync(dirname(OUT_JRE), { recursive: true });
    cpSync(home, OUT_JRE, { recursive: true });
    // Before Tauri embeds into target/*/resources (must be overwritable on rebuild).
    ensureTreeWritable(OUT_JRE);

    writeFileSync(
      join(OUT_JRE, "SILK_JRE_SOURCE.txt"),
      [
        "Eclipse Temurin JRE 17 (HotSpot)",
        `Fetched via: ${url}`,
        `Host: ${os}/${arch}`,
        `Prepared: ${new Date().toISOString()}`,
        "License: GPLv2 + Classpath Exception — see https://adoptium.net/",
        "",
      ].join("\n"),
      "utf8",
    );

    if (!javaBinExists(OUT_JRE)) {
      fail(`JRE staged but java binary missing under ${OUT_JRE}`);
    }
    log(`Staged JRE → ${OUT_JRE}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function ssmPluginBinExists(root) {
  return (
    existsSync(join(root, "session-manager-plugin.exe")) ||
    existsSync(join(root, "session-manager-plugin"))
  );
}

/**
 * NOT YET IMPLEMENTED — see docs/bundled-runtime.md "session-manager-plugin: known gap".
 *
 * Unlike the JRE (a plain archive of a portable binary), AWS's Windows
 * `SessionManagerPlugin.zip` contains an *installer* (`SessionManagerPluginSetup.exe`), and
 * AWS's own docs state that installer requires Administrator rights
 * (https://docs.aws.amazon.com/systems-manager/latest/userguide/install-plugin-windows.html).
 * The runnable plugin binary this app actually needs is `session-manager-plugin.exe`, which
 * only exists after that installer has been run — there is no plain-archive download of it.
 * Silently extracting/copying files out of the installer package would not produce a working
 * binary, so this function deliberately does nothing yet rather than stage something broken.
 *
 * Until this is solved (silently running the elevated installer into a build-controlled
 * directory, or finding an alternative unprivileged distribution of the binary), the SSM
 * tunnel feature only works when the user has separately installed the official Session
 * Manager plugin themselves (same one-time step AWS's own docs describe) and it's on `PATH` —
 * `runtime_paths.rs`'s dev/PATH fallback already covers that case.
 */
async function stageSsmPlugin() {
  if (ssmPluginBinExists(OUT_SSM_PLUGIN)) {
    log(`Bundled session-manager-plugin already present: ${OUT_SSM_PLUGIN}`);
    ensureTreeWritable(OUT_SSM_PLUGIN);
    return;
  }
  log(
    "Skipping session-manager-plugin staging — not implemented yet (needs an elevated installer run; see the comment above stageSsmPlugin in this file). " +
      "The SSM tunnel feature will fall back to a PATH-installed copy of the plugin at runtime.",
  );
}

function writeResourcesReadme() {
  mkdirSync(RESOURCES, { recursive: true });
  const readme = join(RESOURCES, "README.md");
  writeFileSync(
    readme,
    `# Bundled runtime resources

Populated by \`scripts/prepare-runtime-resources.mjs\` (not committed).

| Path | Contents |
| --- | --- |
| \`jdbc-agent/\` | \`jdbc-agent-all.jar\` + \`lib/\` (+ notices) |
| \`jre/\` | Eclipse Temurin JRE 17 for the **build host** OS/arch |
| \`ssm-plugin/\` | AWS \`session-manager-plugin\` binary — not staged automatically yet, see \`docs/bundled-runtime.md\` |

See [\`docs/bundled-runtime.md\`](../../../../docs/bundled-runtime.md).
`,
    "utf8",
  );
}

async function main() {
  writeResourcesReadme();
  stageAgent();
  if (skipJre) {
    log("Skipping JRE (--skip-jre). Packaged builds need a JRE for offline Java.");
  } else {
    await stageJre();
  }
  await stageSsmPlugin();
  log("Done.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
