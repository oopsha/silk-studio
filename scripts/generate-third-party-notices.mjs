// Writes apps/silk-zip/public/third-party-notices.txt: the licences of everything Silk Zip ships.
// The app shows the file (정보 > 오픈 소스 라이선스) and the Store package carries a copy.
// Run again after changing dependencies:  node scripts/generate-third-party-notices.mjs
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(repo, "apps/silk-zip");
const vcpkg = process.env.VCPKG_ROOT ?? join(repo, ".local/vcpkg");
const sevenZip = join(repo, "crates/silk-archive/third_party/7zip");
const read = (path) => readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
const run = (command, options = {}) => execSync(command, { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });

/** Licence files at the top of a package folder. */
function licenceTexts(folder) {
  return readdirSync(folder)
    .filter((name) => /^(licen[cs]e|copying|notice|unlicense|thirdpartynotices)/i.test(name) && statSync(join(folder, name)).isFile())
    .sort()
    .map((name) => read(join(folder, name)));
}

/** npm packages that end up in the bundle, found through the source maps of a scratch build. */
function npmPackages() {
  const out = mkdtempSync(join(tmpdir(), "silk-notices-"));
  try {
    run(`pnpm --filter @silk-studio/zip exec vite build --sourcemap --outDir "${out}" --emptyOutDir`, { stdio: "pipe" });
    const folders = new Set();
    const walk = (folder) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith(".map")) {
          for (const source of JSON.parse(readFileSync(path, "utf8")).sources) {
            const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(source.replace(/\\/g, "/"));
            if (!match) continue;
            // Source paths are relative to the map; resolve them from where the real bundle sits.
            const name = match[1].slice(match[1].indexOf("node_modules/"));
            const found = [resolve(dirname(path), match[1]), join(repo, name)].find((candidate) => existsSync(join(candidate, "package.json")));
            const stored = join(repo, "node_modules/.pnpm", match[1].split("node_modules/.pnpm/")[1] ?? "");
            const folderPath = found ?? (existsSync(join(stored, "package.json")) ? stored : null);
            if (!folderPath) throw new Error(`Package folder not found for ${source}`);
            folders.add(folderPath);
          }
        }
      }
    };
    walk(out);
    // The codicon font is copied as a file, so no source map names it.
    const pnpm = join(repo, "node_modules/.pnpm");
    const codicons = readdirSync(pnpm).filter((name) => name.startsWith("@vscode+codicons@"));
    if (!codicons.length) throw new Error("@vscode/codicons is not installed");
    for (const name of codicons) folders.add(join(pnpm, name, "node_modules/@vscode/codicons"));
    const packages = new Map();
    for (const folder of folders) {
      const info = JSON.parse(read(join(folder, "package.json")));
      packages.set(`${info.name} ${info.version}`, { name: `${info.name} ${info.version}`, licence: info.license ?? "", texts: licenceTexts(folder) });
    }
    return [...packages.values()];
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Third-party Rust crates linked into the app and its Explorer DLL. */
function rustCrates() {
  const metadata = JSON.parse(run("cargo metadata --format-version 1 --filter-platform x86_64-pc-windows-msvc"));
  const packages = new Map(metadata.packages.map((item) => [item.id, item]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const queue = metadata.packages.filter((item) => item.name === "silk-zip" || item.name === "silk-zip-shell").map((item) => item.id);
  const seen = new Set(queue);
  while (queue.length) {
    for (const dependency of nodes.get(queue.pop()).deps) {
      // `kind: null` is a normal dependency; build and test ones are not shipped.
      if (seen.has(dependency.pkg) || !dependency.dep_kinds.some((kind) => kind.kind === null)) continue;
      seen.add(dependency.pkg);
      queue.push(dependency.pkg);
    }
  }
  return [...seen]
    .map((id) => packages.get(id))
    .filter((item) => item.source !== null)
    .map((item) => ({ name: `${item.name} ${item.version}`, licence: item.license ?? "", texts: licenceTexts(dirname(item.manifest_path)) }));
}

const rule = "=".repeat(78);
const section = (title, body) => `${rule}\n${title}\n${rule}\n\n${body}\n`;

/** Packages with identical licence texts share one copy of them. */
function grouped(packages) {
  const groups = new Map();
  for (const item of packages.sort((a, b) => a.name.localeCompare(b.name))) {
    const text = item.texts.join("\n\n---\n\n");
    const key = text || `none:${item.licence}`;
    if (!groups.has(key)) groups.set(key, { names: [], text });
    groups.get(key).names.push(`${item.name} (${item.licence || "see licence text"})`);
  }
  return [...groups.values()]
    .map(({ names, text }) => `${names.join("\n")}\n\n${text || "No licence file in the package; the licence named above applies."}`)
    .join(`\n\n${"-".repeat(78)}\n\n`);
}

const native = ["libarchive", "bzip2", "liblzma", "lz4", "zstd", "zlib", "zlib-ng"].map((port) =>
  section(port, read(join(vcpkg, "installed/x64-windows-static-md/share", port, "copyright"))));

const parts = [
  `Silk Zip - Open Source Notices

Silk Zip includes the software listed below. Each remains under its own licence.

Source code of Silk Zip, including the 7-Zip sources it is built with and the
build scripts needed to rebuild and relink it:
https://github.com/oopsha/silk-studio
`,
  section("7-Zip", `Silk Zip is built with parts of 7-Zip (https://www.7-zip.org), linked statically.
RAR support is used for reading and extracting only.

${read(join(sevenZip, "License.txt"))}`),
  section("GNU Lesser General Public License, version 2.1 (applies to 7-Zip)", read(join(sevenZip, "copying.txt"))),
  ...native,
  section("JavaScript packages", grouped(npmPackages())),
  section("Rust crates", grouped(rustCrates())),
];

const target = join(app, "public/third-party-notices.txt");
writeFileSync(target, `${parts.join("\n")}`, "utf8");
console.log(`Wrote ${target}`);
