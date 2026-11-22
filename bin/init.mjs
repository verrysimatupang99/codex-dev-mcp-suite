#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runInitWizard } from "../lib/init-wizard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function pkgVersion() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8");
    return JSON.parse(raw).version || "unknown";
  } catch { return "unknown"; }
}

// --version/--help must exit before the wizard runs: bare flags like
// `dev-mcp-suite --version` used to write MCP entries into every detected
// client config as a side effect.
if (args.includes("--version") || args.includes("-v")) {
  console.log(`@maximalabs/dev-mcp-suite ${pkgVersion()}`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`dev-mcp-suite ${pkgVersion()} — auto-config installer wizard

Usage:
  dev-mcp-suite            Detect supported MCP clients and write server entries
  dev-mcp-suite --dry-run  Show what would change without writing
  dev-mcp-suite --version  Print version
  dev-mcp-suite --help     This help

The wizard installs: project-memory, devjournal, checkpoint, context-pack.
The optional armada server is configured manually — see README.md.`);
  process.exit(0);
}

async function main() {
  console.log("🛠️ Dev MCP Suite — Auto-Config Installer Wizard");
  console.log("==================================================");

  const dryRun = args.includes("--dry-run");
  const { detectedCount, results } = await runInitWizard({ dryRun });

  if (!detectedCount) {
    console.log("ℹ️ No supported AI client directories detected (~/.codex, ~/.claude, ~/.cursor, etc.).");
    console.log("See README.md for manual configuration instructions.");
    return;
  }

  for (const r of results) {
    console.log(`✅ [${r.status}] Configured ${r.name} -> ${r.path}`);
  }

  console.log("\n🚀 All detected AI tools have been successfully configured with @maximalabs/dev-mcp-suite!");
  console.log("Restart your AI coding client to start using the 4 MCP servers.");
  console.log("(Optional 5th: armada — manual setup, see the Armada section in README.md)");
}

main().catch(console.error);
