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
 * Also stages the AWS session-manager-plugin binary (Windows only for now) used by the SSM
 * tunnel feature — see the comment above stageSsmPlugin() below for how it avoids needing an
 * elevated installer run.
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
const forceSsmPlugin = args.has("--force-ssm-plugin");

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

/** Breadth-first search for the first file named exactly `name` under `root`. */
function findFileNamed(root, name) {
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isFile() && entry.name === name) return full;
      if (entry.isDirectory()) queue.push(full);
    }
  }
  return null;
}

/**
 * Stages the AWS session-manager-plugin binary — the small open-source (Apache-2.0) Go binary
 * that implements the SSM WebSocket data channel for the built-in tunnel feature. Deliberately
 * NOT the full AWS CLI (see the ssm-tunnel feature plan for why).
 *
 * `SessionManagerPlugin.zip` looks like an installer package (it ships `install.bat` /
 * `uninstall.bat`), but inspecting it shows `install.bat` only does two privileged things —
 * copies `package.zip`'s contents into `%PROGRAMFILES%` and registers a Windows service — and
 * `package.zip` itself is a **plain, unprivileged zip** containing the actual portable
 * `bin/session-manager-plugin.exe`. We don't want the Windows-service registration anyway
 * (Silk spawns the plugin as an ad-hoc per-tunnel subprocess), so this extracts `package.zip`
 * directly and skips `install.bat` entirely — no installer execution, no Administrator rights.
 * Windows-only for V1; other hosts are skipped, not failed (see docs/bundled-runtime.md).
 */
async function stageSsmPlugin() {
  if (!forceSsmPlugin && ssmPluginBinExists(OUT_SSM_PLUGIN)) {
    log(`Bundled session-manager-plugin already present: ${OUT_SSM_PLUGIN}`);
    ensureTreeWritable(OUT_SSM_PLUGIN);
    return;
  }

  const os = detectOs();
  if (os !== "windows") {
    log(
      `Skipping session-manager-plugin staging on ${os} (Windows-only for now — see docs/bundled-runtime.md).`,
    );
    return;
  }

  // A stable "latest" pointer (not a versioned API like Adoptium's) — re-verify against AWS's
  // official "Install the Session Manager plugin" docs before a release if it's been a while.
  const url =
    "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/windows/SessionManagerPlugin.zip";

  const tmp = mkdtempSync(join(tmpdir(), "silk-ssm-plugin-"));
  try {
    const archivePath = join(tmp, "SessionManagerPlugin.zip");
    await download(url, archivePath);

    const outerRoot = join(tmp, "outer");
    extractArchive(archivePath, outerRoot);

    const packageZip = findFileNamed(outerRoot, "package.zip");
    if (!packageZip) {
      fail("Could not locate package.zip inside SessionManagerPlugin.zip (AWS may have changed the package layout — see stageSsmPlugin's comment).");
    }

    const innerRoot = join(tmp, "inner");
    extractArchive(packageZip, innerRoot);

    const exePath = findFileNamed(innerRoot, "session-manager-plugin.exe");
    if (!exePath) {
      fail("Could not locate bin/session-manager-plugin.exe inside package.zip.");
    }

    rmSync(OUT_SSM_PLUGIN, { recursive: true, force: true });
    mkdirSync(OUT_SSM_PLUGIN, { recursive: true });
    cpSync(exePath, join(OUT_SSM_PLUGIN, "session-manager-plugin.exe"));
    for (const notice of ["LICENSE", "NOTICE", "THIRD-PARTY"]) {
      const noticePath = findFileNamed(innerRoot, notice);
      if (noticePath) {
        cpSync(noticePath, join(OUT_SSM_PLUGIN, notice));
      }
    }
    ensureTreeWritable(OUT_SSM_PLUGIN);

    writeFileSync(
      join(OUT_SSM_PLUGIN, "SILK_SSM_PLUGIN_SOURCE.txt"),
      [
        "AWS Session Manager Plugin",
        `Fetched via: ${url}`,
        `Host: ${os}`,
        `Prepared: ${new Date().toISOString()}`,
        "License: Apache-2.0 — see https://github.com/aws/session-manager-plugin",
        "Extracted directly from the package's package.zip (bypassing install.bat's Program",
        "Files copy + Windows service registration, which this app doesn't use or need).",
        "",
      ].join("\n"),
      "utf8",
    );

    if (!ssmPluginBinExists(OUT_SSM_PLUGIN)) {
      fail(`session-manager-plugin staged but binary missing under ${OUT_SSM_PLUGIN}`);
    }
    log(`Staged session-manager-plugin → ${OUT_SSM_PLUGIN}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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
| \`ssm-plugin/\` | AWS \`session-manager-plugin\` binary (Windows build host only for now), see \`docs/bundled-runtime.md\` |

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
