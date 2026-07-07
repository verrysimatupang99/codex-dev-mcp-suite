#!/usr/bin/env node

/**
 * Dev Journal MCP Server for Codex
 *
 * Per-project session timeline + handoff so you never lose your place when a
 * session hits "input too long" / gets compacted / you start fresh.
 *
 * Core idea:
 *   - journal_handoff: at end of a work block, store "what I did + open
 *     questions + next steps + active files". One canonical resume point.
 *   - journal_resume: at start of a new session, get the latest handoff +
 *     recent entries, so you (or the agent) can continue immediately.
 *
 * Storage: append-only JSONL per project (default
 *   ~/.codex/memories/journal/<project-slug>/journal.jsonl) + a
 *   handoff.json for the latest canonical resume state. Human-readable
 *   journal.md mirror is also maintained.
 *
 * Tools: journal_log, journal_handoff, journal_resume,
 *        journal_timeline, journal_clear_handoff
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { rerank, rerankConfig } from "./rerank.js";
import { deterministicEnabled } from "./env.js";

const ROOT =
  process.env.JOURNAL_DIR ||
  path.join(os.homedir(), ".ai-shared-memory", "journal");

const MAX_TEXT = 20_000;

function slug(dir) {
  const resolved = path.resolve(dir || process.cwd());
  const base = path.basename(resolved) || "root";
  const hash = crypto.createHash("sha1").update(resolved).digest("hex").slice(0, 8);
  return `${base.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 40)}-${hash}`;
}
function nowIso() { return new Date().toISOString(); }
function clip(v, name, max, req = true) {
  const t = String(v ?? "");
  if (req && !t.trim()) throw new Error(`${name} is required`);
  if (t.length > max) throw new Error(`${name} exceeds ${max} chars`);
  return t;
}
function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split("\n").map((s) => s.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
  return [];
}

class DevJournalServer {
  constructor() {
    this.server = new Server({ name: "devjournal", version: "1.0.0" }, { capabilities: { tools: {} } });
    this.setup();
  }

  paths(dir) {
    const s = slug(dir);
    const d = path.join(ROOT, s);
    return {
      slug: s,
      root: path.resolve(dir || process.cwd()),
      dir: d,
      jsonl: path.join(d, "journal.jsonl"),
      md: path.join(d, "journal.md"),
      handoff: path.join(d, "handoff.json"),
    };
  }

  async append(p, entry) {
    await fs.mkdir(p.dir, { recursive: true });
    await fs.appendFile(p.jsonl, JSON.stringify(entry) + "\n");
    const md = `\n## ${entry.ts} — ${entry.type}${entry.title ? `: ${entry.title}` : ""}\n${entry.body || ""}\n`;
    await fs.appendFile(p.md, md);
  }

  async readEntries(p, limit = 50) {
    try {
      const raw = await fs.readFile(p.jsonl, "utf8");
      const rows = raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      return rows.slice(-limit);
    } catch { return []; }
  }

  setup() {
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: "journal_log",
          description: "Append a quick timestamped entry (note/decision/blocker/done) to the project journal.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short summary" },
              body: { type: "string", description: "Details (Markdown ok)" },
              type: { type: "string", description: "note | decision | blocker | done | idea", default: "note" },
              ts: { type: "string", description: "Optional ISO timestamp to backdate the entry" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
            },
            required: ["title"],
          },
        },
        {
          name: "journal_handoff",
          description: "Save the canonical resume point for this project: what was done, open questions, next steps, and active files. Call before ending a session or when context is about to be compacted.",
          inputSchema: {
            type: "object",
            properties: {
              summary: { type: "string", description: "What was accomplished this session" },
              next_steps: { type: "array", items: { type: "string" }, description: "Ordered next actions" },
              open_questions: { type: "array", items: { type: "string" }, description: "Unresolved questions" },
              active_files: { type: "array", items: { type: "string" }, description: "Files currently in focus" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
            },
            required: ["summary"],
          },
        },
        {
          name: "journal_resume",
          description: "Get the latest handoff plus recent journal entries to resume work in a fresh session. Call this FIRST in a new session instead of re-pasting context.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              recent: { type: "number", description: "How many recent entries to include", default: 8 },
            },
          },
        },
        {
          name: "journal_timeline",
          description: "Show recent journal entries (newest last) for the project.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              limit: { type: "number", description: "Max entries", default: 20 },
              type: { type: "string", description: "Filter by type (optional)" },
            },
          },
        },
        {
          name: "journal_search",
          description: "Find the most relevant journal entries for a query. Uses keyword prefilter + LLM rerank (9router Kiro) when available, else keyword scoring. Use to recall what you did about a topic across past sessions.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "What you're looking for" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              limit: { type: "number", description: "Max entries", default: 5 },
            },
            required: ["query"],
          },
        },
        {
          name: "journal_clear_handoff",
          description: "Clear the current canonical handoff (e.g., after fully resuming).",
          inputSchema: {
            type: "object",
            properties: { dir: { type: "string", description: "Project directory (defaults to CWD)" } },
          },
        },
        {
          name: "initialize_agent_session",
          description: "Initialize the current agent session. Run this ONCE when the agent starts in a new project to perform a handshake and get contextual handoff.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      try {
        switch (name) {
          case "journal_log": return await this.log(args || {});
          case "journal_handoff": return await this.doHandoff(args || {});
          case "journal_resume": return await this.resume(args || {});
          case "journal_timeline": return await this.timeline(args || {});
          case "journal_search": return await this.search(args || {});
          case "journal_clear_handoff": return await this.clearHandoff(args || {});
          case "initialize_agent_session": return await this.initializeAgent(args || {});
          default: throw new Error(`Unknown tool: ${name}`);
        }
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    });
  }

  async log({ title, body, type = "note", dir, ts: tsArg }) {
    title = clip(title, "title", 500);
    body = clip(body, "body", MAX_TEXT, false);
    const p = this.paths(dir);
    const ts = (tsArg && /^\d{4}-\d{2}-\d{2}/.test(String(tsArg))) ? String(tsArg) : nowIso();
    const entry = { ts, type, title, body };
    await this.append(p, entry);
    return { content: [{ type: "text", text: `Logged [${type}] "${title}" to ${p.slug}` }] };
  }

  async doHandoff({ summary, next_steps, open_questions, active_files, dir }) {
    summary = clip(summary, "summary", MAX_TEXT);
    const p = this.paths(dir);
    const handoff = {
      ts: nowIso(),
      summary,
      next_steps: asList(next_steps),
      open_questions: asList(open_questions),
      active_files: asList(active_files),
    };
    await fs.mkdir(p.dir, { recursive: true });
    await fs.writeFile(p.handoff, JSON.stringify(handoff, null, 2));
    await this.append(p, { ts: handoff.ts, type: "handoff", title: "Session handoff", body: summary });
    return { content: [{ type: "text", text: `Handoff saved for ${p.slug}\nNext steps: ${handoff.next_steps.length}, open questions: ${handoff.open_questions.length}, active files: ${handoff.active_files.length}` }] };
  }

  async resume({ dir, recent = 8 }) {
    const p = this.paths(dir);
    let handoff = null;
    try { handoff = JSON.parse(await fs.readFile(p.handoff, "utf8")); } catch { /* none */ }
    const entries = await this.readEntries(p, Math.max(1, Math.min(50, recent)));

    if (!handoff && entries.length === 0) {
      return { content: [{ type: "text", text: `No journal for ${p.slug} yet. Use journal_handoff / journal_log to start.` }] };
    }

    const out = [`# Resume: ${p.slug}`, `Project path: ${p.root}`];
    if (handoff) {
      out.push(`\n## Latest handoff (${handoff.ts})`);
      out.push(handoff.summary);
      if (handoff.next_steps?.length) out.push(`\n### Next steps\n` + handoff.next_steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
      if (handoff.open_questions?.length) out.push(`\n### Open questions\n` + handoff.open_questions.map((s) => `- ${s}`).join("\n"));
      if (handoff.active_files?.length) out.push(`\n### Active files\n` + handoff.active_files.map((s) => `- ${s}`).join("\n"));
    } else {
      out.push(`\n(No canonical handoff saved — showing recent entries only.)`);
    }
    if (entries.length) {
      out.push(`\n## Recent entries`);
      out.push(entries.map((e) => `- ${e.ts} [${e.type}] ${e.title}`).join("\n"));
    }
    return { content: [{ type: "text", text: out.join("\n") }] };
  }

  async timeline({ dir, limit = 20, type }) {
    const p = this.paths(dir);
    let entries = await this.readEntries(p, 200);
    if (type) entries = entries.filter((e) => e.type === type);
    entries = entries.slice(-Math.max(1, Math.min(200, limit)));
    if (!entries.length) return { content: [{ type: "text", text: `No journal entries for ${p.slug}${type ? ` of type ${type}` : ""}.` }] };
    const lines = entries.map((e) => `- ${e.ts} [${e.type}] ${e.title}${e.body ? `\n    ${e.body.split("\n")[0].slice(0, 120)}` : ""}`);
    return { content: [{ type: "text", text: `Timeline for ${p.slug} (${entries.length}):\n${lines.join("\n")}` }] };
  }

  async search({ query, dir, limit = 5 }) {
    query = clip(query, "query", 2000);
    const p = this.paths(dir);
    const entries = await this.readEntries(p, 200);
    if (!entries.length) return { content: [{ type: "text", text: `No journal entries for ${p.slug}.` }] };

    const want = Math.max(1, Math.min(20, limit));
    const q = new Set((query.toLowerCase().match(/[a-z0-9_./-]{2,}/g) || []));
    const score = (e) => {
      let sc = 0;
      const hay = `${e.title || ""} ${e.body || ""} ${e.type || ""}`.toLowerCase();
      const toks = new Set(hay.match(/[a-z0-9_./-]{2,}/g) || []);
      for (const t of q) if (toks.has(t)) sc += 1;
      return sc;
    };

    let ranked = entries.map((e, i) => ({ e, i, sc: score(e) }))
      .sort((a, b) => b.sc - a.sc || b.i - a.i);
    let pool = ranked.filter((x) => x.sc > 0).slice(0, 20);
    let mode = deterministicEnabled() ? "deterministic" : "keyword";
    if (pool.length === 0 && rerankConfig().enabled) {
      pool = ranked.slice(0, 20); // fall back to recent for semantic-style queries
    }

    let result = pool.slice(0, want).map((x) => x.e);
    if (rerankConfig().enabled && pool.length > 1) {
      const cands = pool.map((x) => ({ id: String(x.i), title: x.e.title || "(no title)", snippet: x.e.body || x.e.type || "" }));
      const order = await rerank(query, cands, want);
      if (order) {
        mode = "rerank";
        const byId = new Map(pool.map((x) => [String(x.i), x.e]));
        const picked = order.map((id) => byId.get(id)).filter(Boolean).slice(0, want);
        if (picked.length) result = picked;
      }
    }

    if (!result.length) return { content: [{ type: "text", text: `No relevant journal entries for "${query}" in ${p.slug}.` }] };
    const lines = result.map((e) => `- ${e.ts} [${e.type}] ${e.title}${e.body ? `\n    ${e.body.split("\n")[0].slice(0, 160)}` : ""}`);
    return { content: [{ type: "text", text: `Journal search for "${query}" in ${p.slug} [${mode}]:\n${lines.join("\n")}` }] };
  }

  async clearHandoff({ dir }) {
    const p = this.paths(dir);
    await fs.unlink(p.handoff).catch(() => {});
    return { content: [{ type: "text", text: `Cleared handoff for ${p.slug}` }] };
  }

  async initializeAgent({ dir }) {
    const agentName = process.env.MCP_AGENT_NAME || 'Unknown-Agent';
    const resumeData = await this.resume({ dir, recent: 5 });
    
    let rules = "";
    try {
      const p = this.paths(dir);
      const rulePath = path.join(p.root, ".ai", "AGENTS.md");
      const r = await fs.readFile(rulePath, "utf8");
      rules = `\n\n## Project Rules (.ai/AGENTS.md)\n${r}`;
    } catch { 
      try {
        const rootRule = path.join(this.paths(dir).root, "AGENTS.md");
        const rr = await fs.readFile(rootRule, "utf8");
        rules = `\n\n## Project Rules (AGENTS.md)\n${rr}`;
      } catch {}
    }

    const greeting = `# Universal MCP Handshake\nAgent: ${agentName}\n\n`;
    const content = greeting + resumeData.content[0].text + rules;
    
    return { content: [{ type: "text", text: content }] };
  }

  async run() {
    const t = new StdioServerTransport();
    await this.server.connect(t);
    console.error(`Dev Journal MCP server running on stdio (store: ${ROOT})`);
  }
}

new DevJournalServer().run().catch(console.error);
