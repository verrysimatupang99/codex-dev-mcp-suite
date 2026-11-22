#!/usr/bin/env node

/**
 * Armada MCP Server — fleet ops for AI agents.
 *
 * Talks to an Armada bus (https://github.com/verrysimatupang99/armada):
 * an append-only mailbox + job queue that thin wr-node daemons poll from
 * every host — outbound only, no inbound ports, no SSH fan-in.
 *
 * Agents use these tools to watch host health and enqueue policy-gated
 * jobs. Whether a job actually runs is decided by the TARGET host's own
 * policy (capability ladder: health < allow < user < root < sandbox);
 * this server only delivers requests — the node has veto.
 *
 * Config (env): ARMADA_BUS_URL or BUS_URL (origin, no /bus suffix),
 * ARMADA_BUS_TOKEN or BUS_TOKEN, ARMADA_AGENT (agent identity label).
 * Fallback: ~/.config/armada/agent.env — the same file the `armada` CLI
 * reads, so credentials are shared.
 *
 * Tools: fleet_health, fleet_jobs, job_post, job_status, job_watch,
 *        job_tail, job_cancel, bus_note, bus_read
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import os from "os";
import path from "path";

// ---------- config ----------

function loadAgentEnv() {
  try {
    const p = path.join(os.homedir(), ".config", "armada", "agent.env");
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i <= 0 || line.trim().startsWith("#")) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (k && !(k in process.env)) process.env[k] = v;
    }
  } catch {}
}
loadAgentEnv();

const BUS_URL = (process.env.ARMADA_BUS_URL || process.env.BUS_URL || "")
  .replace(/\/+$/, "");
const TOKEN = (process.env.ARMADA_BUS_TOKEN || process.env.BUS_TOKEN || "").trim();
const AGENT = (process.env.ARMADA_AGENT || os.hostname()).slice(0, 64);
const MODES = ["allow", "user", "root", "sandbox"];

// ---------- bus client ----------

async function bus(method, p, body) {
  if (!BUS_URL) throw new Error("ARMADA_BUS_URL/BUS_URL kosong — set env atau ~/.config/armada/agent.env");
  if (!TOKEN) throw new Error("ARMADA_BUS_TOKEN/BUS_TOKEN kosong — set env atau ~/.config/armada/agent.env");
  const res = await fetch(BUS_URL + p, {
    method,
    headers: { "X-Bus-Token": TOKEN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!res.ok) {
    const msg = typeof data === "object" && data?.error ? data.error : `HTTP ${res.status}`;
    const e = new Error(`bus ${method} ${p}: ${msg}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

const ok = (text) => ({ content: [{ type: "text", text }] });
const terminal = (s) => ["done", "failed", "expired", "cancelled"].includes(s);

// ---------- server ----------

class ArmadaServer {
  constructor() {
    this.server = new Server({ name: "armada", version: "1.0.0" }, { capabilities: { tools: {} } });
    this.setup();
  }

  setup() {
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: "fleet_health",
          description: "Fleet status board: which hosts heartbeat recently (online vs stale) and which agents are active. Call first to see what hosts exist before posting jobs.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "fleet_jobs",
          description: "List the most recent jobs across the fleet (id, host, agent, mode, state, exit code).",
          inputSchema: {
            type: "object",
            properties: {
              state: { type: "string", description: "Filter: queued|claimed|done|failed|expired|cancelled (default: all)" },
            },
          },
        },
        {
          name: "job_post",
          description: "Enqueue a job on a host. argv is exec'd directly (no shell — no pipes/;). mode: 'allow' = strict allowlist, 'user' = daemon's user, 'root' = sudo, 'sandbox' = docker container. The HOST's policy grants or denies — a 200 here means queued, not permitted. Set dedupe for idempotent retry.",
          inputSchema: {
            type: "object",
            properties: {
              host: { type: "string", description: "Target host name (see fleet_health)" },
              argv: { type: "array", items: { type: "string" }, description: "Command argv, e.g. [\"df\",\"-h\"]" },
              mode: { type: "string", enum: MODES, default: "allow" },
              dedupe: { type: "string", description: "Idempotency key — reposts return the original job" },
              after_id: { type: "string", description: "Run only after this job id finishes done" },
              timeout_sec: { type: "number", description: "Kill after N seconds (default 300)" },
              ttl_sec: { type: "number", description: "Expire if unclaimed for N seconds (default 86400)" },
              priority: { type: "number", description: "Lower runs earlier (default 50)" },
              env_profile: { type: "string", description: "Name of a LOCAL env profile on the target host — secrets never transit the bus" },
            },
            required: ["host", "argv"],
          },
        },
        {
          name: "job_status",
          description: "Current state of one job: queued|claimed|done|failed|expired|cancelled, cancel flag, exit code.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "Job id" } },
            required: ["id"],
          },
        },
        {
          name: "job_watch",
          description: "Poll a job until it reaches a terminal state or max_wait_sec elapses. Returns state + exit code.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Job id" },
              max_wait_sec: { type: "number", description: "Give up after N seconds (default 60, max 300)", default: 60 },
            },
            required: ["id"],
          },
        },
        {
          name: "job_tail",
          description: "Read a job's audit trail: streamed stdout chunks + final result (exit code, stdout, stderr).",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "Job id" } },
            required: ["id"],
          },
        },
        {
          name: "job_cancel",
          description: "Cancel a job: queued jobs are cancelled outright; claimed jobs get a cancel flag the node honours by killing the process.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "Job id" } },
            required: ["id"],
          },
        },
        {
          name: "bus_note",
          description: "Leave a note on a bus topic for other agents (append-only, never deleted — don't post secrets).",
          inputSchema: {
            type: "object",
            properties: {
              topic: { type: "string", description: "Topic name", default: "warroom" },
              text: { type: "string", description: "Note body" },
              kind: { type: "string", description: "Message kind (default: note)", default: "note" },
            },
            required: ["text"],
          },
        },
        {
          name: "bus_read",
          description: "Read messages on a bus topic (e.g. 'warroom', 'health/<host>', 'job/<id>').",
          inputSchema: {
            type: "object",
            properties: {
              topic: { type: "string", description: "Topic name", default: "warroom" },
              since: { type: "number", description: "Only seq > N", default: 0 },
              limit: { type: "number", description: "Max messages (default 20)", default: 20 },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      try {
        switch (name) {
          case "fleet_health": return await this.fleetHealth();
          case "fleet_jobs": return await this.fleetJobs(args || {});
          case "job_post": return await this.jobPost(args || {});
          case "job_status": return await this.jobStatus(args || {});
          case "job_watch": return await this.jobWatch(args || {});
          case "job_tail": return await this.jobTail(args || {});
          case "job_cancel": return await this.jobCancel(args || {});
          case "bus_note": return await this.busNote(args || {});
          case "bus_read": return await this.busRead(args || {});
          default: throw new Error(`Unknown tool: ${name}`);
        }
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    });
  }

  async fleetHealth() {
    const [topics, agents] = await Promise.all([
      bus("GET", "/bus/topics"),
      bus("GET", "/bus/agents"),
    ]);
    const now = Date.now() / 1000;
    const lines = [`bus: ${BUS_URL}`, "", "hosts (heartbeat):"];
    const healthTopics = (topics.topics || []).filter((t) => t.topic.startsWith("health/"));
    if (!healthTopics.length) lines.push("  (none yet)");
    for (const t of healthTopics.sort((a, b) => b.last_ts - a.last_ts)) {
      const age = Math.round(now - t.last_ts);
      const state = age > 300 ? "STALE" : "ok";
      lines.push(`  ${t.topic.replace("health/", "").padEnd(20)} ${state.padEnd(5)} ${age}s ago  (${t.n} beats)`);
    }
    lines.push("", "agents seen:");
    const seen = (agents.agents || [])
      .sort((a, b) => b.last_ts - a.last_ts).slice(0, 15);
    if (!seen.length) lines.push("  (none)");
    for (const a of seen) {
      lines.push(`  ${a.agent}@${a.host || "-"}  ${Math.round(now - a.last_ts)}s ago`);
    }
    return ok(lines.join("\n"));
  }

  async fleetJobs({ state }) {
    const r = await bus("GET", "/bus/job/list" + (state ? `?state=${encodeURIComponent(state)}` : ""));
    const jobs = r.jobs || [];
    if (!jobs.length) return ok("no jobs");
    const lines = jobs.slice(0, 30).map((j) =>
      `${String(j.id).slice(0, 20).padEnd(22)} ${String(j.host).slice(0, 14).padEnd(15)} ` +
      `${String(j.agent).slice(0, 18).padEnd(19)} ${String(j.mode).padEnd(8)} ${String(j.state).padEnd(9)} ` +
      `exit=${j.exit_code ?? "-"}`
    );
    return ok(lines.join("\n"));
  }

  async jobPost(a) {
    if (!Array.isArray(a.argv) || !a.argv.length || !a.argv.every((x) => typeof x === "string"))
      throw new Error("argv wajib array string non-kosong");
    const body = {
      host: a.host, mode: a.mode || "allow", argv: a.argv,
      dedupe: a.dedupe, after_id: a.after_id, ttl_sec: a.ttl_sec,
      timeout_sec: a.timeout_sec, priority: a.priority, env_profile: a.env_profile,
    };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    const r = await bus("POST", "/bus/job/post", body);
    return ok(`${r.id}  state=${r.state}${r.deduped ? " (deduped)" : ""}\n` +
      `queued on ${a.host} as ${AGENT} — run job_watch to follow, job_tail for output`);
  }

  async jobStatus({ id }) {
    const r = await bus("GET", `/bus/job/status?id=${encodeURIComponent(id)}`);
    return ok(JSON.stringify(r));
  }

  async jobWatch({ id, max_wait_sec = 60 }) {
    const cap = Math.min(Number(max_wait_sec) || 60, 300);
    const deadline = Date.now() + cap * 1000;
    const seen = [];
    while (Date.now() < deadline) {
      const r = await bus("GET", `/bus/job/status?id=${encodeURIComponent(id)}`);
      const line = `${r.state}${r.exit_code != null ? ` exit=${r.exit_code}` : ""}`;
      if (seen[seen.length - 1] !== line) seen.push(line);
      if (terminal(r.state)) {
        return ok(`${id}: ${seen.join(" → ")}\n(final: ${line})`);
      }
      await new Promise((r2) => setTimeout(r2, 3000));
    }
    return ok(`${id}: ${seen.join(" → ")}\n(still running after ${cap}s — check job_tail)`);
  }

  async jobTail({ id }) {
    const [msgs, list] = await Promise.all([
      bus("GET", `/bus/messages?topic=${encodeURIComponent("job/" + id)}&limit=100`),
      bus("GET", "/bus/job/list"),
    ]);
    const lines = [];
    for (const m of msgs.messages || []) {
      const body = m.kind === "result"
        ? (() => { try { const j = JSON.parse(m.text); return `result exit=${j.exit_code}\nstdout:\n${j.stdout || ""}\nstderr:\n${j.stderr || ""}`; } catch { return m.text; } })()
        : m.text;
      lines.push(`[${m.agent} ${m.kind}] ${body}`);
    }
    const j = (list.jobs || []).find((x) => x.id === id);
    if (j) lines.push(`-- state=${j.state} exit=${j.exit_code ?? "-"} claimed_by=${j.claim_agent || "-"}`);
    return ok(lines.length ? lines.join("\n") : `no audit yet for ${id}`);
  }

  async jobCancel({ id }) {
    const r = await bus("POST", "/bus/job/cancel", { id });
    return ok(`cancel ${id}: ${JSON.stringify(r)}`);
  }

  async busNote({ topic = "warroom", text, kind = "note" }) {
    if (!text || !String(text).trim()) throw new Error("text wajib");
    const r = await bus("POST", "/bus/post", {
      topic, text: String(text), kind, agent: AGENT,
    });
    return ok(`posted to ${r.topic} seq=${r.seq} as ${AGENT}`);
  }

  async busRead({ topic = "warroom", since = 0, limit = 20 }) {
    const r = await bus("GET",
      `/bus/messages?topic=${encodeURIComponent(topic)}&since=${since}&limit=${limit}`);
    const msgs = r.messages || [];
    if (!msgs.length) return ok(`(kosong di topic ${topic})`);
    const lines = msgs.map((m) => {
      const ts = new Date(m.ts * 1000).toISOString().slice(11, 19);
      return `${ts} #${m.seq} [${m.agent}@${m.host || "-"}] ${m.text.slice(0, 500)}`;
    });
    return ok(lines.join("\n"));
  }
}

const srv = new ArmadaServer();
await srv.server.connect(new StdioServerTransport());
