#!/usr/bin/env node
/**
 * Runs every server's test.mjs and any top-level tests/*.test.mjs,
 * then prints a combined summary. Usage: node run-tests.mjs
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVERS = ["project-memory", "checkpoint", "context-pack", "devjournal"];
const EXTRA_TESTS = fs.existsSync("tests")
  ? fs.readdirSync("tests").filter((f) => f.endsWith(".test.mjs")).map((f) => `tests/${f}`)
  : [];

/** Run a single test file by absolute path. */
function runFile(absPath) {
  return new Promise((resolve) => {
    const proc = spawn("node", [absPath], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    proc.on("close", (code) => resolve({ name: path.basename(path.dirname(absPath)) || absPath, code, out }));
  });
}

const results = [];

for (const s of SERVERS) {
  console.log(`\n=== ${s} ===`);
  const r = await runFile(path.join(__dirname, s, "test.mjs"));
  process.stdout.write(r.out);
  results.push({ ...r, name: s });
}

for (const t of EXTRA_TESTS) {
  console.log(`\n=== ${t} ===`);
  const r = await runFile(path.join(__dirname, t));
  process.stdout.write(r.out);
  results.push({ ...r, name: t });
}

console.log("\n================ SUMMARY ================");
let anyFail = false;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) anyFail = true;
  const m = r.out.match(/(\d+) passed, (\d+) failed/);
  const stat = m ? `${m[1]} passed, ${m[2]} failed` : (ok ? "ok" : "FAILED");
  console.log(`  ${ok ? "✓" : "✗"} ${r.name.padEnd(28)} ${stat}`);
}
console.log("========================================");
process.exit(anyFail ? 1 : 0);
