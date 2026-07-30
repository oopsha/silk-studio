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
 */

import { createWriteStream } from "node:fs";
import {
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
  log("Done.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
