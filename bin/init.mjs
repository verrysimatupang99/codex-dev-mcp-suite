#!/usr/bin/env node
import { runInitWizard } from "../lib/init-wizard.js";

async function main() {
  console.log("🛠️ Dev MCP Suite — Auto-Config Installer Wizard");
  console.log("==================================================");

  const dryRun = process.argv.includes("--dry-run");
  const { detectedCount, results } = await runInitWizard({ dryRun });

  if (!detectedCount) {
    console.log("ℹ️ No supported AI client directories detected (~/.codex, ~/.claude, ~/.cursor, etc.).");
    console.log("See README.md for manual configuration instructions.");
    return;
  }

  for (const r of results) {
    console.log(`✅ [${r.status}] Configured ${r.name} -> ${r.path}`);
  }

  console.log("\n🚀 All detected AI tools have been successfully configured with codex-dev-mcp-suite!");
  console.log("Restart your AI coding client to start using the 4 MCP servers.");
}

main().catch(console.error);
