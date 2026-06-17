/**
 * Dev MCP Suite — prune library.
 *
 * Identifies and removes "temp" project slugs (prefix `tmp.`) from all three
 * stores. Used by `bin/prune.mjs`. No MCP, no stdio — safe to import from tests.
 *
 * Storage layout (matches the rest of the suite):
 *   <root>/vault/<slug>/
 *   <root>/journal/<slug>/
 *   <root>/checkpoints/<slug>/
 */

import fs from "fs";
import path from "path";

export const STORES = ["vault", "journal", "checkpoints"];
const TEMP_PREFIX = "tmp.";

/** Returns the list of slug names matching temp pattern across all stores. */
export function findTempSlugs({ root }) {
  const set = new Set();
  for (const store of STORES) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, store), { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith(TEMP_PREFIX)) set.add(e.name);
    }
  }
  return [...set].sort();
}

/** Recursively sum bytes under each slug's directories across stores. */
export function estimateBytes({ root, slugs }) {
  let total = 0;
  for (const slug of slugs) {
    for (const store of STORES) {
      total += dirSize(path.join(root, store, slug));
    }
  }
  return total;
}

function dirSize(p) {
  let total = 0;
  let stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    let stat;
    try { stat = fs.lstatSync(cur); } catch { continue; }
    if (stat.isDirectory()) {
      let children = [];
      try { children = fs.readdirSync(cur); } catch { continue; }
      for (const c of children) stack.push(path.join(cur, c));
    } else {
      total += stat.size;
    }
  }
  return total;
}

/** Validate slugs only contain temp prefix — refuse to delete otherwise. */
function assertTempSlugs(slugs) {
  for (const s of slugs) {
    if (!s.startsWith(TEMP_PREFIX)) {
      throw new Error(`refusing to remove non-temp slug: "${s}" (must start with "${TEMP_PREFIX}")`);
    }
  }
}

/** Compute a plan: per-slug list of stores where the dir exists + total bytes. */
export function planPrune({ root }) {
  const slugs = findTempSlugs({ root });
  return slugs.map((slug) => {
    const stores = [];
    for (const store of STORES) {
      const p = path.join(root, store, slug);
      try {
        if (fs.existsSync(p)) stores.push(store);
      } catch { /* ignore */ }
    }
    const bytes = estimateBytes({ root, slugs: [slug] });
    return { slug, stores, bytes };
  });
}

/**
 * Remove temp slugs from all stores. Default is dry-run (no deletion).
 * @param {{ root: string, slugs: string[], dryRun?: boolean }} opts
 * @returns {{ removed: string[], skipped: string[], errors: Array<{slug:string,store:string,error:string}> }}
 */
export function applyPrune({ root, slugs, dryRun = true }) {
  assertTempSlugs(slugs);
  const removed = [];
  const skipped = [];
  const errors = [];
  for (const slug of slugs) {
    let anyRemoved = false;
    for (const store of STORES) {
      const p = path.join(root, store, slug);
      if (!fs.existsSync(p)) continue;
      if (dryRun) { skipped.push(slug); continue; }
      try {
        fs.rmSync(p, { recursive: true, force: true });
        anyRemoved = true;
      } catch (e) {
        errors.push({ slug, store, error: String(e && e.message || e) });
      }
    }
    if (anyRemoved) removed.push(slug);
  }
  return { removed, skipped, errors };
}
