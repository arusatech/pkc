#!/usr/bin/env node
/**
 * Ensures the Electron binary is present. Prefer npm's install.js;
 * fall back to extracting a matching zip from the local Electron cache.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const electronRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "electron");
const pathTxt = join(electronRoot, "path.txt");
const distApp = join(electronRoot, "dist", "Electron.app", "Contents", "MacOS", "Electron");
const distExe = join(electronRoot, "dist", "electron.exe");
const distLinux = join(electronRoot, "dist", "electron");

function binaryOk() {
  if (process.platform === "darwin") return existsSync(distApp);
  if (process.platform === "win32") return existsSync(distExe);
  return existsSync(distLinux);
}

if (binaryOk() && existsSync(pathTxt)) {
  process.exit(0);
}

const installJs = join(electronRoot, "install.js");
if (existsSync(installJs)) {
  const r = spawnSync(process.execPath, [installJs], { stdio: "inherit" });
  if (r.status === 0 && binaryOk()) process.exit(0);
}

const cacheRoot = join(homedir(), "Library", "Caches", "electron");
if (process.platform === "darwin" && existsSync(cacheRoot)) {
  const hashes = readdirSync(cacheRoot);
  for (const hash of hashes) {
    const dir = join(cacheRoot, hash);
    const zips = readdirSync(dir).filter((f) => f.endsWith(".zip"));
    for (const zip of zips) {
      const dist = join(electronRoot, "dist");
      rmSync(dist, { recursive: true, force: true });
      mkdirSync(dist, { recursive: true });
      execFileSync("unzip", ["-q", join(dir, zip), "-d", dist]);
      writeFileSync(pathTxt, "Electron.app/Contents/MacOS/Electron");
      if (binaryOk()) {
        console.log("Restored Electron binary from cache:", zip);
        process.exit(0);
      }
    }
  }
}

console.warn(
  "Electron binary is missing. From electron/: run `node node_modules/electron/install.js`",
);
process.exit(0);
