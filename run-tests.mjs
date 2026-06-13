#!/usr/bin/env node
/**
 * Runs every server's test.mjs and prints a combined summary.
 * Usage: node run-tests.mjs   (from ~/.codex/mcp-servers)
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVERS = ["project-memory", "checkpoint", "context-pack", "devjournal"];

function runOne(name) {
  return new Promise((resolve) => {
    const test = path.join(__dirname, name, "test.mjs");
    const proc = spawn("node", [test], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    proc.on("close", (code) => resolve({ name, code, out }));
  });
}

const results = [];
for (const s of SERVERS) {
  console.log(`\n=== ${s} ===`);
  const r = await runOne(s);
  process.stdout.write(r.out);
  results.push(r);
}

console.log("\n================ SUMMARY ================");
let anyFail = false;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) anyFail = true;
  const m = r.out.match(/(\d+) passed, (\d+) failed/);
  const stat = m ? `${m[1]} passed, ${m[2]} failed` : (ok ? "ok" : "FAILED");
  console.log(`  ${ok ? "✓" : "✗"} ${r.name.padEnd(16)} ${stat}`);
}
console.log("========================================");
process.exit(anyFail ? 1 : 0);
