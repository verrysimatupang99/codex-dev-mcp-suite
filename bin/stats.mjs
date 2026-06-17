#!/usr/bin/env node
/**
 * bin/stats.mjs — Dev MCP Suite stats CLI.
 *
 * Usage:
 *   stats [--root <path>] [--json] [--top N] [--help] [--version]
 *
 * Default storage root: ~/.codex/memories (override via --root or
 * MEMORY_VAULT_DIR / JOURNAL_DIR / CHECKPOINT_DIR siblings).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { computeStats, formatText, formatJson } from "../lib/stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || "unknown";
  } catch { return "unknown"; }
}

function resolveRoot() {
  // Precedence: explicit --root > vault env > journal env > checkpoint env > ~/.codex/memories
  const fromFlag = process.env.STATS_ROOT;
  if (fromFlag) return path.resolve(fromFlag);
  for (const k of ["MEMORY_VAULT_DIR", "JOURNAL_DIR", "CHECKPOINT_DIR"]) {
    const v = process.env[k];
    if (v) {
      // each server stores under <root>/<subdir>, so the root is the parent
      const sub = k === "MEMORY_VAULT_DIR" ? "vault" : k === "JOURNAL_DIR" ? "journal" : "checkpoints";
      const parent = path.dirname(v);
      if (path.basename(parent) === sub) return parent;
      return parent;
    }
  }
  return path.join(os.homedir(), ".codex", "memories");
}

function parseArgs(argv) {
  const opts = { root: null, json: false, top: 10, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-v" || a === "--version") opts.version = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--root") opts.root = path.resolve(argv[++i]);
    else if (a.startsWith("--root=")) opts.root = path.resolve(a.slice("--root=".length));
    else if (a === "--top") opts.top = parseInt(argv[++i], 10) || 10;
    else if (a.startsWith("--top=")) opts.top = parseInt(a.slice("--top=".length), 10) || 10;
    else if (a === "--") { /* ignore rest */ break; }
    else if (!a.startsWith("-")) opts.root = path.resolve(a);
    else {
      process.stderr.write(`stats: unknown flag: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

function printHelp() {
  const out = [
    `stats (Dev MCP Suite) v${pkgVersion()}`,
    "",
    "Summarize local memory storage (vault / journal / checkpoints).",
    "",
    "Usage:",
    "  stats [root] [--root <path>] [--json] [--top N]",
    "  stats --help | --version",
    "",
    "Options:",
    "  --root <path>   Storage root (default: ~/.codex/memories or first env var of",
    "                  MEMORY_VAULT_DIR / JOURNAL_DIR / CHECKPOINT_DIR)",
    "  --json          Emit machine-readable JSON instead of human text",
    "  --top N         How many entries in top-project / recent-activity lists",
    "                  (default: 10)",
    "  -h, --help      Show this help",
    "  -v, --version   Print version",
    "",
    "Examples:",
    "  stats                       # summary of default storage",
    "  stats --json | jq .totals   # totals only",
    "  stats --root /tmp/mem       # use a different root",
  ];
  process.stdout.write(out.join("\n") + "\n");
}

const opts = parseArgs(process.argv.slice(2));
if (opts.version) { process.stdout.write(`${pkgVersion()}\n`); process.exit(0); }
if (opts.help) { printHelp(); process.exit(0); }

const root = opts.root || resolveRoot();
const stats = computeStats({ root, topLimit: opts.top });

if (opts.json) {
  process.stdout.write(formatJson(stats) + "\n");
} else {
  process.stdout.write(formatText(stats) + "\n");
}
