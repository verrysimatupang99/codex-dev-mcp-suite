/**
 * Dev MCP Suite — stats aggregation library.
 *
 * Pure functions for summarizing local memory storage across the three stores
 * (vault / journal / checkpoints). No MCP, no stdio — used by bin/stats.mjs
 * and safe to import from tests.
 *
 * Storage layout assumed (see each MCP server's server.js for source of truth):
 *   <root>/vault/<slug>/notes/*.md            (one .md per memory_save note)
 *   <root>/journal/<slug>/journal.jsonl       (append-only entries)
 *   <root>/journal/<slug>/handoff.json        (optional)
 *   <root>/checkpoints/<slug>/snapshots/<id>/ (one dir per snapshot)
 *   <root>/checkpoints/<slug>/manifest.json   (checkpoint index)
 */

import fs from "fs";
import path from "path";

const VAULT_DIRNAME = "vault";
const JOURNAL_DIRNAME = "journal";
const CHECKPOINT_DIRNAME = "checkpoints";

function safeListDirs(parent) {
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function safeListFiles(parent) {
  try {
    return fs.readdirSync(parent);
  } catch {
    return [];
  }
}

function newestMtimeMs(dir) {
  try {
    const stat = fs.statSync(dir);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

function isoFromMs(ms) {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

function isTempSlug(slug) {
  return /^tmp\./.test(slug);
}

function summarizeProject(slug, { root }) {
  const vaultDir = path.join(root, VAULT_DIRNAME, slug);
  const journalDir = path.join(root, JOURNAL_DIRNAME, slug);
  const cpDir = path.join(root, CHECKPOINT_DIRNAME, slug);

  const notesDir = path.join(vaultDir, "notes");
  const notes = safeListFiles(notesDir).filter((f) => f.endsWith(".md")).length;

  let journalEntries = 0;
  let lastEntryTs = null;
  const jl = path.join(journalDir, "journal.jsonl");
  if (fs.existsSync(jl)) {
    try {
      const lines = fs.readFileSync(jl, "utf8").split("\n").filter(Boolean);
      journalEntries = lines.length;
      // journal entries are append-only and roughly time-ordered; parse first + last
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj && obj.ts) {
            if (!lastEntryTs || obj.ts > lastEntryTs) lastEntryTs = obj.ts;
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* ignore read errors */ }
  }

  // checkpoints: count snapshot dirs
  let checkpoints = 0;
  const snapsDir = path.join(cpDir, "snapshots");
  if (fs.existsSync(snapsDir)) {
    checkpoints = safeListDirs(snapsDir).length;
  }

  // last activity across all artifacts (mtime fallback)
  let lastActivityMs = 0;
  for (const d of [vaultDir, journalDir, cpDir]) {
    const m = newestMtimeMs(d);
    if (m > lastActivityMs) lastActivityMs = m;
  }
  // prefer parsed entry ts if newer than filesystem mtime
  if (lastEntryTs) {
    const t = Date.parse(lastEntryTs);
    if (!Number.isNaN(t) && t > lastActivityMs) lastActivityMs = t;
  }
  const lastActivityTs = isoFromMs(lastActivityMs);

  return {
    slug,
    notes,
    journalEntries,
    checkpoints,
    lastActivityTs,
    temp: isTempSlug(slug),
  };
}

/**
 * Compute aggregate stats for a memory root.
 * @param {object} opts
 * @param {string} opts.root - absolute path to memories root (containing vault/, journal/, checkpoints/)
 * @param {number} [opts.topLimit=10] - max entries in topByNotes / recentActivity
 * @returns {{
 *   root: string,
 *   totals: { notes: number, journalProjects: number, checkpoints: number },
 *   projectCount: number,
 *   topByNotes: Array<{ slug: string, notes: number }>,
 *   recentActivity: Array<{ slug: string, ts: string }>,
 *   tempSlugs: string[],
 *   perProject: Array<{ slug: string, notes: number, journalEntries: number, checkpoints: number, lastActivityTs: string|null, temp: boolean }>,
 * }}
 */
export function computeStats({ root, topLimit = 10 } = {}) {
  if (!root) throw new Error("computeStats: `root` is required");

  // union of slugs across all three stores
  const slugSet = new Set();
  for (const store of [VAULT_DIRNAME, JOURNAL_DIRNAME, CHECKPOINT_DIRNAME]) {
    for (const slug of safeListDirs(path.join(root, store))) slugSet.add(slug);
  }

  const perProject = [...slugSet]
    .map((slug) => summarizeProject(slug, { root }))
    .sort((a, b) => {
      if (a.temp !== b.temp) return a.temp ? 1 : -1; // real first
      return a.slug.localeCompare(b.slug);
    });

  const totals = perProject.reduce(
    (acc, p) => ({
      notes: acc.notes + p.notes,
      journalProjects: acc.journalProjects + (p.journalEntries > 0 ? 1 : 0),
      checkpoints: acc.checkpoints + p.checkpoints,
    }),
    { notes: 0, journalProjects: 0, checkpoints: 0 },
  );

  const topByNotes = [...perProject]
    .filter((p) => p.notes > 0)
    .sort((a, b) => b.notes - a.notes || a.slug.localeCompare(b.slug))
    .slice(0, topLimit)
    .map((p) => ({ slug: p.slug, notes: p.notes }));

  const recentActivity = [...perProject]
    .filter((p) => p.lastActivityTs && !p.temp)
    .sort((a, b) => (a.lastActivityTs < b.lastActivityTs ? 1 : -1))
    .slice(0, topLimit)
    .map((p) => ({ slug: p.slug, ts: p.lastActivityTs }));

  const tempSlugs = perProject.filter((p) => p.temp).map((p) => p.slug).sort();

  return {
    root,
    totals,
    projectCount: perProject.length,
    topByNotes,
    recentActivity,
    tempSlugs,
    perProject,
  };
}

/** Right-pad a slug to a fixed display width. */
function pad(s, w) {
  s = String(s);
  if (s.length >= w) return s + " ";
  return s + " ".repeat(w - s.length);
}
function rpadNum(n, w) {
  const s = String(n);
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

function formatLocal(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  } catch {
    return ts;
  }
}

/**
 * Human-readable text summary.
 * @param {ReturnType<typeof computeStats>} stats
 * @param {object} [opts]
 * @param {string} [opts.timezone="UTC"] - display-only label, not used to convert
 */
export function formatText(stats, opts = {}) {
  const lines = [];
  lines.push("Dev MCP Suite — stats");
  lines.push("======================");
  lines.push(`Storage root: ${stats.root}`);
  lines.push("");
  lines.push("Totals");
  lines.push("------");
  lines.push(`  Notes:           ${stats.totals.notes}`);
  lines.push(`  Journal projects:${rpadNum(stats.totals.journalProjects, 2)}`);
  lines.push(`  Checkpoints:     ${stats.totals.checkpoints}`);
  lines.push(`  Distinct projects: ${stats.projectCount}`);
  lines.push("");

  if (stats.topByNotes.length) {
    lines.push(`Top projects by notes (top ${stats.topByNotes.length})`);
    lines.push("------------------------");
    const slugW = Math.max(8, ...stats.topByNotes.map((p) => p.slug.length));
    for (const p of stats.topByNotes) {
      lines.push(`  ${rpadNum(p.notes, 4)}  ${pad(p.slug, slugW)}`);
    }
    lines.push("");
  }

  if (stats.recentActivity.length) {
    lines.push("Most recent activity");
    lines.push("--------------------");
    const slugW = Math.max(8, ...stats.recentActivity.map((p) => p.slug.length));
    for (const p of stats.recentActivity) {
      lines.push(`  ${pad(p.slug, slugW)} ${formatLocal(p.ts)}`);
    }
    lines.push("");
  }

  if (stats.tempSlugs.length) {
    lines.push(`Temp/cleanup candidates (${stats.tempSlugs.length})`);
    lines.push("------------------------");
    for (const slug of stats.tempSlugs) lines.push(`  ${slug}`);
    lines.push("");
  } else {
    lines.push("Temp/cleanup candidates: none");
    lines.push("");
  }

  lines.push(`Generated at ${new Date().toISOString()}`);
  return lines.join("\n");
}

/** Stable JSON serialization (sorted keys for top-level + totals). */
export function formatJson(stats) {
  const out = {
    root: stats.root,
    totals: stats.totals,
    projectCount: stats.projectCount,
    topByNotes: stats.topByNotes,
    recentActivity: stats.recentActivity,
    tempSlugs: stats.tempSlugs,
    perProject: stats.perProject,
    generatedAt: new Date().toISOString(),
  };
  return JSON.stringify(out, null, 2);
}
