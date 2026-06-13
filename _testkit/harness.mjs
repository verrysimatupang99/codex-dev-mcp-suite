/**
 * Minimal MCP stdio test harness — zero external deps.
 * Provides: McpClient (spawn server, initialize, callTool), and a tiny
 * assert/test runner (describe/it/run) with colored-ish plain output.
 */
import { spawn } from "child_process";

export class McpClient {
  constructor(serverPath, env = {}) {
    this.serverPath = serverPath;
    this.env = { ...process.env, ...env };
    this.proc = null;
    this.buf = "";
    this.pending = new Map();
    this.nextId = 1;
  }

  async start() {
    this.proc = spawn("node", [this.serverPath], { env: this.env, stdio: ["pipe", "pipe", "ignore"] });
    this.proc.stdout.on("data", (d) => this._onData(d.toString()));
    await this._rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "testkit", version: "1.0.0" },
    });
    this._notify("notifications/initialized");
    await new Promise((r) => setTimeout(r, 50));
  }

  _onData(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        resolve(msg);
      }
    }
  }

  _send(obj) { this.proc.stdin.write(JSON.stringify(obj) + "\n"); }
  _notify(method, params) { this._send({ jsonrpc: "2.0", method, params }); }

  _rpc(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); } });
      this._send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async listTools() {
    const res = await this._rpc("tools/list", {});
    return (res.result?.tools || []).map((t) => t.name);
  }

  async callTool(name, args = {}, timeoutMs = 30000) {
    const res = await this._rpc("tools/call", { name, arguments: args }, timeoutMs);
    if (res.error) throw new Error(`RPC error: ${res.error.message}`);
    const text = res.result?.content?.[0]?.text ?? "";
    return { text, isError: Boolean(res.result?.isError), raw: res.result };
  }

  async stop() {
    try { this.proc?.kill(); } catch { /* ignore */ }
  }
}

// ---- tiny test runner ----
const tests = [];
let currentSuite = "";
export function describe(name, fn) { currentSuite = name; fn(); currentSuite = ""; }
export function it(name, fn) { tests.push({ suite: currentSuite, name, fn }); }

export function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + (msg || ""));
}
export function assertIncludes(haystack, needle, msg) {
  if (!String(haystack).includes(needle)) {
    throw new Error(`expected to include "${needle}"${msg ? " — " + msg : ""}\n  got: ${String(haystack).slice(0, 300)}`);
  }
}
export function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}${msg ? " — " + msg : ""}`);
}

export async function run() {
  let pass = 0, fail = 0;
  const failures = [];
  for (const t of tests) {
    const label = t.suite ? `${t.suite} › ${t.name}` : t.name;
    try {
      await t.fn();
      pass++;
      console.log(`  ✓ ${label}`);
    } catch (e) {
      fail++;
      failures.push({ label, err: e });
      console.log(`  ✗ ${label}`);
      console.log(`      ${e.message.split("\n").join("\n      ")}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed (${tests.length} total)`);
  if (fail > 0) process.exitCode = 1;
  return { pass, fail, failures };
}

// unique temp dir helper
import os from "os";
import path from "path";
import fs from "fs";
export function tmpDir(prefix = "mcp-test-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return d;
}
export function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ } }
