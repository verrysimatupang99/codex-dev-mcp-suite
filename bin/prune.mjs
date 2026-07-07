#!/usr/bin/env node
/**
 * bin/prune.mjs — Dev MCP Suite prune CLI.
 *
 * Removes temp project slugs (prefix `tmp.`) from all stores. Default is
 * DRY-RUN — nothing is deleted unless you pass `--yes`.
 *
 * Usage:
 *   prune [--root <path>] [--yes] [--json]
 *   prune --help | --version
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { findTempSlugs, planPrune, applyPrune } from "../lib/prune.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || "unknown";
  } catch { return "unknown"; }
}

function resolveRoot() {
  const fromFlag = process.env.PRUNE_ROOT;
  if (fromFlag) return path.resolve(fromFlag);
  for (const k of ["MEMORY_VAULT_DIR", "JOURNAL_DIR", "CHECKPOINT_DIR"]) {
    const v = process.env[k];
    if (v) {
      const sub = k === "MEMORY_VAULT_DIR" ? "vault" : k === "JOURNAL_DIR" ? "journal" : "checkpoints";
      const parent = path.dirname(v);
      if (path.basename(parent) === sub) return parent;
      return parent;
    }
  }
  return path.join(os.homedir(), ".ai-shared-memory");
}

function parseArgs(argv) {
  const opts = { root: null, yes: false, json: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-v" || a === "--version") opts.version = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--dry-run") opts.yes = false;
    else if (a === "--root") opts.root = path.resolve(argv[++i]);
    else if (a.startsWith("--root=")) opts.root = path.resolve(a.slice("--root=".length));
    else if (!a.startsWith("-")) opts.root = path.resolve(a);
    else {
      process.stderr.write(`prune: unknown flag: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function printHelp() {
  const out = [
    `prune (Dev MCP Suite) v${pkgVersion()}`,
    "",
    "Remove temp project slugs (prefix tmp.) from vault, journal, and",
    "checkpoints. Default is DRY-RUN — nothing is deleted without --yes.",
    "",
    "Usage:",
    "  prune [root] [--root <path>] [--yes] [--json]",
    "  prune --help | --version",
    "",
    "Options:",
    "  --yes, -y    Actually delete. Without this, only a dry-run report is printed.",
    "  --dry-run    Force dry-run mode (default).",
    "  --json       Machine-readable JSON output.",
    "  --root <p>   Storage root (default: ~/.codex/memories or first env var of",
    "               MEMORY_VAULT_DIR / JOURNAL_DIR / CHECKPOINT_DIR)",
    "  -h, --help",
    "  -v, --version",
    "",
    "Safety: refuses to delete any slug that does not start with `tmp.`.",
    "",
    "Examples:",
    "  prune                       # dry-run report",
    "  prune --yes                 # delete after seeing the plan",
    "  prune --yes --json          # machine-readable delete report",
  ];
  process.stdout.write(out.join("\n") + "\n");
}

const opts = parseArgs(process.argv.slice(2));
if (opts.version) { process.stdout.write(`${pkgVersion()}\n`); process.exit(0); }
if (opts.help) { printHelp(); process.exit(0); }

const root = opts.root || resolveRoot();
const plan = planPrune({ root });

if (plan.length === 0) {
  if (opts.json) {
    process.stdout.write(JSON.stringify({ root, plan: [], removed: [], skipped: [], errors: [] }, null, 2) + "\n");
  } else {
    process.stdout.write(`No temp slugs found under ${root}.\n`);
  }
  process.exit(0);
}

if (!opts.yes) {
  // dry-run report
  if (opts.json) {
    process.stdout.write(JSON.stringify({ root, dryRun: true, plan, removed: [], skipped: [], errors: [] }, null, 2) + "\n");
  } else {
    const lines = [];
    lines.push(`Dev MCP Suite — prune (DRY RUN)`);
    lines.push("=================================");
    lines.push(`Storage root: ${root}`);
    lines.push(`Found ${plan.length} temp slug${plan.length === 1 ? "" : "s"}:`);
    let totalBytes = 0;
    for (const e of plan) {
      lines.push(`  ${e.slug.padEnd(36)} ${fmtBytes(e.bytes).padStart(10)}   stores: ${e.stores.join(",")}`);
      totalBytes += e.bytes;
    }
    lines.push(`  ${"TOTAL".padEnd(36)} ${fmtBytes(totalBytes).padStart(10)}`);
    lines.push("");
    lines.push("Re-run with `--yes` to actually delete.");
    process.stdout.write(lines.join("\n") + "\n");
  }
  process.exit(0);
}

// actually delete
const slugs = plan.map((p) => p.slug);
const result = applyPrune({ root, slugs, dryRun: false });
const totalFreed = plan.reduce((a, p) => a + p.bytes, 0);

if (opts.json) {
  process.stdout.write(JSON.stringify({ root, dryRun: false, plan, ...result, bytesFreed: totalFreed }, null, 2) + "\n");
} else {
  const lines = [];
  lines.push(`Dev MCP Suite — prune`);
  lines.push("=====================");
  lines.push(`Storage root: ${root}`);
  lines.push(`Removed ${result.removed.length} slug${result.removed.length === 1 ? "" : "s"} (freed ~${fmtBytes(totalFreed)})`);
  for (const slug of result.removed) lines.push(`  ✓ ${slug}`);
  if (result.errors.length) {
    lines.push("");
    lines.push(`Errors (${result.errors.length}):`);
    for (const e of result.errors) lines.push(`  ✗ ${e.slug} [${e.store}]: ${e.error}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}

process.exit(result.errors.length > 0 ? 1 : 0);
