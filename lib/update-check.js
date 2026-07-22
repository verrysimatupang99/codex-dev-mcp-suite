/**
 * Non-blocking, cached upstream update checker for Dev MCP Suite.
 * Checks npm registry (https://registry.npmjs.org/codex-dev-mcp-suite/latest)
 * once every 24 hours. Safe for stdio MCP transport (logs only to stderr).
 */

import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const CACHE_FILE = path.join(os.homedir(), ".ai-shared-memory", ".update-check-cache.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PKG_NAME = "codex-dev-mcp-suite";

/** Reads current package version from package.json */
function getCurrentVersion() {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(dir, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || "1.8.2";
  } catch {
    return "1.8.2";
  }
}

/** Simple version comparator (e.g. "1.9.0" > "1.8.2") */
export function isNewerVersion(current, latest) {
  if (!current || !latest) return false;
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

/** Check npm registry for latest version asynchronously with timeout */
function fetchLatestNpmVersion() {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${PKG_NAME}/latest`,
      { headers: { "User-Agent": `${PKG_NAME}-update-check` }, timeout: 1500 },
      (res) => {
        if (res.statusCode !== 200) return resolve(null);
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            resolve(data.version || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Triggers a background check for updates.
 * Never blocks process execution or breaks stdio protocol.
 */
export async function checkForUpdates() {
  try {
    if (process.env.MCP_DISABLE_UPDATE_CHECK || process.env.CI || process.env.NO_NETWORK) {
      return null;
    }
    const now = Date.now();
    let cache = { lastCheck: 0, latestVersion: null };

    // Read existing cache if available
    try {
      if (fs.existsSync(CACHE_FILE)) {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      }
    } catch { /* ignore cache read error */ }

    const currentVersion = getCurrentVersion();

    // If cache is fresh, check cached latest version
    if (now - (cache.lastCheck || 0) < CHECK_INTERVAL_MS && cache.latestVersion) {
      if (isNewerVersion(currentVersion, cache.latestVersion)) {
        console.error(
          `\n💡 [Dev MCP Suite] Update available: ${currentVersion} → ${cache.latestVersion}\n` +
          `   Run "npm i -g ${PKG_NAME}@latest" or use "npx -y -p ${PKG_NAME}@latest"\n`
        );
      }
      return;
    }

    // Perform background check
    fetchLatestNpmVersion().then((latest) => {
      if (!latest) return;

      // Update cache
      try {
        const cacheDir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: now, latestVersion: latest }));
      } catch { /* ignore cache write error */ }

      if (isNewerVersion(currentVersion, latest)) {
        console.error(
          `\n💡 [Dev MCP Suite] Update available: ${currentVersion} → ${latest}\n` +
          `   Run "npm i -g ${PKG_NAME}@latest" or use "npx -y -p ${PKG_NAME}@latest"\n`
        );
      }
    }).catch(() => {});
  } catch {
    /* Silent catch: update checks must never throw or disrupt the application */
  }
}
