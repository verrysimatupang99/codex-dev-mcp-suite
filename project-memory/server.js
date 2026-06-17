#!/usr/bin/env node

/**
 * Project Memory MCP Server for Codex
 *
 * Idea: Obsidian-style local Markdown vault + Context7-style on-demand recall.
 * Persists per-directory notes/activity to .md files (with YAML frontmatter)
 * and maintains a keyword index so a fresh session can pull back only the
 * relevant context instead of re-pasting everything.
 *
 * Vault layout (default ~/.codex/memories/vault):
 *   <project-slug>/
 *     notes/<id>.md        # one note per file, plain Markdown + frontmatter
 *     index.json           # keyword + metadata index for fast recall
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { embed, embedOne, cosine, embeddingConfig } from "./embedding.js";
import { rerank, rerankConfig } from "./rerank.js";
import { deterministicEnabled } from "./env.js";
import { computeStats, formatText, formatJson } from "../lib/stats.js";

const VAULT_ROOT =
  process.env.MEMORY_VAULT_DIR ||
  path.join(os.homedir(), ".codex", "memories", "vault");

const MAX_CONTENT = 200_000;
const MAX_TITLE = 200;
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "to",
  "of", "in", "on", "at", "by", "is", "are", "was", "were", "be", "this",
  "that", "it", "as", "with", "from", "we", "i", "you", "he", "she", "they",
  "not", "no", "do", "did", "does", "can", "will", "so", "my", "our", "your",
]);

function projectSlug(dir) {
  const resolved = path.resolve(dir || process.cwd());
  const base = path.basename(resolved) || "root";
  const hash = crypto.createHash("sha1").update(resolved).digest("hex").slice(0, 8);
  const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 40);
  return `${safeBase}-${hash}`;
}

function tokenize(text) {
  return (String(text || "").toLowerCase().match(/[a-z0-9_./-]{2,}/g) || [])
    .filter((w) => !STOPWORDS.has(w));
}

function nowIso() {
  return new Date().toISOString();
}

function genId() {
  return (
    new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) +
    "-" +
    crypto.randomBytes(3).toString("hex")
  );
}

function limit(value, name, max, required = true) {
  const text = String(value ?? "");
  if (required && !text.trim()) throw new Error(`${name} is required`);
  if (text.length > max) throw new Error(`${name} exceeds ${max} characters`);
  return text;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, "");
    }
    meta[key] = val;
  }
  return { meta, body: m[2] };
}

function buildFrontmatter(meta) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`);
    else lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

class ProjectMemoryServer {
  constructor() {
    this.server = new Server(
      { name: "project-memory", version: "1.0.0" },
      { capabilities: { tools: {}, resources: {} } }
    );
    this.setupHandlers();
  }

  paths(dir) {
    const slug = projectSlug(dir);
    const projectDir = path.join(VAULT_ROOT, slug);
    return {
      slug,
      projectDir,
      notesDir: path.join(projectDir, "notes"),
      indexFile: path.join(projectDir, "index.json"),
    };
  }

  async loadIndex(p) {
    try {
      const raw = await fs.readFile(p.indexFile, "utf8");
      return JSON.parse(raw);
    } catch {
      return { project: p.slug, updated: nowIso(), notes: {} };
    }
  }

  async saveIndex(p, index) {
    index.updated = nowIso();
    await fs.mkdir(p.projectDir, { recursive: true });
    await fs.writeFile(p.indexFile, JSON.stringify(index, null, 2));
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: "memory_save",
          description:
            "Save a note/decision/activity to the project's Markdown vault and index it for later recall. Use after meaningful work so a fresh session can recover context.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short title/summary" },
              content: { type: "string", description: "Markdown body: details, decisions, code refs" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
              kind: { type: "string", description: "note | decision | task | log | snippet", default: "note" },
              created: { type: "string", description: "Optional ISO timestamp to backdate the note (e.g. original session time)" },
            },
            required: ["title", "content"],
          },
        },
        {
          name: "memory_recall",
          description:
            "Retrieve the most relevant saved notes for a query using the keyword index. Call this at the start of a new session instead of re-pasting context.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "What you need context about" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              limit: { type: "number", description: "Max notes to return", default: 5 },
              full: { type: "boolean", description: "Return full bodies instead of excerpts", default: false },
            },
            required: ["query"],
          },
        },
        {
          name: "memory_list",
          description: "List saved notes for a project (newest first) with id, title, tags, timestamp.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              limit: { type: "number", description: "Max notes", default: 20 },
            },
          },
        },
        {
          name: "memory_get",
          description: "Fetch the full Markdown content of a single note by id.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Note id" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
            },
            required: ["id"],
          },
        },
        {
          name: "memory_delete",
          description: "Delete a note by id from the vault and index.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Note id" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
            },
            required: ["id"],
          },
        },
        {
          name: "memory_reindex",
          description: "Backfill semantic embeddings for notes that don't have one yet (run after the embedding model becomes available). Safe to call repeatedly.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              force: { type: "boolean", description: "Re-embed all notes, not just missing ones", default: false },
            },
          },
        },
        {
          name: "memory_stats",
          description: "Summarize local memory storage across vault / journal / checkpoints: totals, top projects, recent activity, and temp-slug cleanup candidates. Returns the same text as the `stats` CLI.",
          inputSchema: {
            type: "object",
            properties: {
              root: { type: "string", description: "Storage root (default: ~/.codex/memories or first env var of MEMORY_VAULT_DIR / JOURNAL_DIR / CHECKPOINT_DIR)" },
              top: { type: "number", description: "How many entries in top-project / recent-activity lists (default 10)", default: 10 },
              json: { type: "boolean", description: "Return machine-readable JSON instead of human text", default: false },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        switch (name) {
          case "memory_save": return await this.save(args || {});
          case "memory_recall": return await this.recall(args || {});
          case "memory_list": return await this.list(args || {});
          case "memory_get": return await this.get(args || {});
          case "memory_delete": return await this.del(args || {});
          case "memory_reindex": return await this.reindex(args || {});
          case "memory_stats": return await this.stats(args || {});
          default: throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    });

    // Resources: expose every saved note as a read-only resource across all
    // projects in the vault. URI form: memory://<project-slug>/<noteId>
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = [];
      let slugs = [];
      try { slugs = await fs.readdir(VAULT_ROOT); } catch { slugs = []; }
      for (const slug of slugs) {
        const indexFile = path.join(VAULT_ROOT, slug, "index.json");
        let index; try { index = JSON.parse(await fs.readFile(indexFile, "utf8")); } catch { continue; }
        for (const n of Object.values(index.notes || {})) {
          resources.push({
            uri: `memory://${slug}/${n.id}`,
            name: n.title || n.id,
            description: `[${n.kind || "note"}] ${(n.tags || []).join(", ")} — ${n.created || ""}`.trim(),
            mimeType: "text/markdown",
          });
        }
      }
      return { resources };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri || "";
      const m = uri.match(/^memory:\/\/([^/]+)\/(.+)$/);
      if (!m) throw new Error(`Unknown resource URI: ${uri}`);
      const [, slug, noteId] = m;
      const indexFile = path.join(VAULT_ROOT, slug, "index.json");
      let index; try { index = JSON.parse(await fs.readFile(indexFile, "utf8")); } catch { throw new Error(`Project not found: ${slug}`); }
      const note = index.notes?.[noteId];
      if (!note) throw new Error(`Note not found: ${noteId}`);
      const raw = await fs.readFile(path.join(VAULT_ROOT, slug, note.file), "utf8");
      return { contents: [{ uri, mimeType: "text/markdown", text: raw }] };
    });
  }

  async save({ title, content, dir, tags, kind = "note", created: createdArg }) {
    title = limit(title, "title", MAX_TITLE);
    content = limit(content, "content", MAX_CONTENT);
    const tagList = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
    const p = this.paths(dir);
    await fs.mkdir(p.notesDir, { recursive: true });

    const id = genId();
    const created = (createdArg && /^\d{4}-\d{2}-\d{2}/.test(String(createdArg))) ? String(createdArg) : nowIso();
    const meta = { id, title, kind, tags: tagList, created, dir: path.resolve(dir || process.cwd()) };
    const file = path.join(p.notesDir, `${id}.md`);
    await fs.writeFile(file, buildFrontmatter(meta) + `# ${title}\n\n${content}\n`);

    const index = await this.loadIndex(p);
    const keywords = [...new Set([...tokenize(title), ...tokenize(content), ...tagList.map((t) => t.toLowerCase())])];
    const note = { id, title, kind, tags: tagList, created, keywords, file: path.relative(p.projectDir, file) };

    const vec = await embedOne(`${title}\n\n${content}`);
    let embedded = false;
    if (vec) { note.embedding = vec; note.embModel = embeddingConfig().model; embedded = true; }

    index.notes[id] = note;
    await this.saveIndex(p, index);

    return { content: [{ type: "text", text: `Saved note ${id} → ${p.slug}\nFile: ${file}\nKeywords indexed: ${keywords.length}${embedded ? " (semantic embedding stored)" : " (keyword-only; embeddings unavailable)"}` }] };
  }

  async recall({ query, dir, limit: lim = 5, full = false }) {
    query = limit(query, "query", 2000);
    const p = this.paths(dir);
    const index = await this.loadIndex(p);
    const notes = Object.values(index.notes || {});
    if (notes.length === 0) {
      return { content: [{ type: "text", text: `No memories for ${p.slug} yet. Use memory_save first.` }] };
    }
    const qTokens = new Set(tokenize(query));
    const kw = (n) => {
      let score = 0;
      for (const k of n.keywords || []) if (qTokens.has(k)) score += 1;
      for (const t of n.tags || []) if (qTokens.has(t.toLowerCase())) score += 2;
      for (const w of tokenize(n.title)) if (qTokens.has(w)) score += 2;
      return score;
    };

    let mode = deterministicEnabled() ? "deterministic" : "keyword";
    const qVec = deterministicEnabled() ? null : await embedOne(query);
    const haveEmb = qVec && notes.some((n) => Array.isArray(n.embedding));

    let scored;
    if (haveEmb) {
      mode = "semantic";
      const maxKw = Math.max(1, ...notes.map(kw));
      scored = notes.map((n) => {
        const sim = Array.isArray(n.embedding) ? cosine(qVec, n.embedding) : 0;
        const kwNorm = kw(n) / maxKw;
        const score = 0.8 * sim + 0.2 * kwNorm;
        return { n, score, sim };
      }).filter((x) => x.score > 0.05)
        .sort((a, b) => b.score - a.score || (a.n.created < b.n.created ? 1 : -1))
        .slice(0, Math.max(1, Math.min(20, lim)));
    } else {
      const want = Math.max(1, Math.min(20, lim));
      const kwRanked = notes.map((n) => ({ n, score: kw(n) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || (a.n.created < b.n.created ? 1 : -1));

      // Build a candidate pool for the LLM reranker. If keyword found nothing,
      // fall back to most-recent notes so semantic-style queries still work.
      let pool = kwRanked.slice(0, 20);
      if (pool.length === 0 && rerankConfig().enabled) {
        pool = notes.slice().sort((a, b) => (a.created < b.created ? 1 : -1)).slice(0, 20).map((n) => ({ n, score: 0 }));
      }

      let reranked = null;
      if (rerankConfig().enabled && pool.length > 1) {
        const cands = [];
        for (const { n } of pool) {
          const raw = await fs.readFile(path.join(p.projectDir, n.file), "utf8").catch(() => "");
          const { body } = parseFrontmatter(raw);
          cands.push({ id: n.id, title: n.title, snippet: body });
        }
        const order = await rerank(query, cands, want);
        if (order) {
          mode = "rerank";
          const byId = new Map(pool.map((x) => [x.n.id, x.n]));
          reranked = order.map((id) => byId.get(id)).filter(Boolean).slice(0, want).map((n) => ({ n, score: 0 }));
        }
      }

      scored = (reranked && reranked.length)
        ? reranked
        : kwRanked.slice(0, want);
    }

    if (scored.length === 0) {
      return { content: [{ type: "text", text: `No relevant memories for "${query}" in ${p.slug}. Try memory_list.` }] };
    }

    const blocks = [];
    for (const { n, score, sim } of scored) {
      const raw = await fs.readFile(path.join(p.projectDir, n.file), "utf8").catch(() => "");
      const { body } = parseFrontmatter(raw);
      const text = full ? body.trim() : body.trim().split("\n").slice(0, 12).join("\n");
      const tag = mode === "semantic" ? `sim:${(sim ?? 0).toFixed(3)}` : (mode === "rerank" ? "llm-ranked" : `score:${score}`);
      blocks.push(`### ${n.title}  (id:${n.id}, ${tag}, ${n.created})\n${text}`);
    }
    return { content: [{ type: "text", text: `Recall for "${query}" in ${p.slug} [${mode}]:\n\n${blocks.join("\n\n---\n\n")}` }] };
  }

  async list({ dir, limit: lim = 20 }) {
    const p = this.paths(dir);
    const index = await this.loadIndex(p);
    const notes = Object.values(index.notes || {})
      .sort((a, b) => (a.created < b.created ? 1 : -1))
      .slice(0, Math.max(1, Math.min(200, lim)));
    if (notes.length === 0) return { content: [{ type: "text", text: `No memories for ${p.slug} yet.` }] };
    const lines = notes.map((n) => `- ${n.id} [${n.kind}] ${n.title}${n.tags?.length ? ` (#${n.tags.join(" #")})` : ""} — ${n.created}`);
    return { content: [{ type: "text", text: `Memories in ${p.slug} (${notes.length}):\n${lines.join("\n")}` }] };
  }

  async get({ id, dir }) {
    id = limit(id, "id", 100);
    const p = this.paths(dir);
    const index = await this.loadIndex(p);
    const meta = index.notes?.[id];
    if (!meta) throw new Error(`Note ${id} not found in ${p.slug}`);
    const raw = await fs.readFile(path.join(p.projectDir, meta.file), "utf8");
    return { content: [{ type: "text", text: raw }] };
  }

  async del({ id, dir }) {
    id = limit(id, "id", 100);
    const p = this.paths(dir);
    const index = await this.loadIndex(p);
    const meta = index.notes?.[id];
    if (!meta) throw new Error(`Note ${id} not found in ${p.slug}`);
    await fs.unlink(path.join(p.projectDir, meta.file)).catch(() => {});
    delete index.notes[id];
    await this.saveIndex(p, index);
    return { content: [{ type: "text", text: `Deleted note ${id} from ${p.slug}` }] };
  }

  async reindex({ dir, force = false }) {
    const p = this.paths(dir);
    if (deterministicEnabled()) return { content: [{ type: "text", text: `Reindex ${p.slug}: skipped (deterministic no-network mode; embeddings disabled).` }] };
    const index = await this.loadIndex(p);
    const notes = Object.values(index.notes || {});
    if (notes.length === 0) return { content: [{ type: "text", text: `No memories for ${p.slug} yet.` }] };

    const targets = notes.filter((n) => force || !Array.isArray(n.embedding));
    if (targets.length === 0) return { content: [{ type: "text", text: `All ${notes.length} notes already embedded in ${p.slug}.` }] };

    let done = 0, failed = 0;
    for (const n of targets) {
      const raw = await fs.readFile(path.join(p.projectDir, n.file), "utf8").catch(() => "");
      const { body } = parseFrontmatter(raw);
      const vec = await embedOne(`${n.title}\n\n${body}`);
      if (vec) { n.embedding = vec; n.embModel = embeddingConfig().model; done++; }
      else { failed++; }
    }
    await this.saveIndex(p, index);
    return { content: [{ type: "text", text: `Reindex ${p.slug}: embedded ${done}, failed ${failed} (embeddings ${embeddingConfig().enabled ? "configured" : "not configured"}). ${failed ? "Failures usually mean the embedding model is unavailable right now." : ""}` }] };
  }

  async stats({ root: explicitRoot, top = 10, json = false } = {}) {
    const root = explicitRoot
      ? path.resolve(explicitRoot)
      : (process.env.MEMORY_VAULT_DIR
          ? path.dirname(process.env.MEMORY_VAULT_DIR)
          : process.env.JOURNAL_DIR
            ? path.dirname(process.env.JOURNAL_DIR)
            : process.env.CHECKPOINT_DIR
              ? path.dirname(process.env.CHECKPOINT_DIR)
              : path.join(os.homedir(), ".codex", "memories"));
    const stats = computeStats({ root, topLimit: top });
    const text = json ? formatJson(stats) : formatText(stats);
    return { content: [{ type: "text", text }] };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Project Memory MCP server running on stdio (vault: ${VAULT_ROOT})`);
  }
}

const server = new ProjectMemoryServer();
server.run().catch(console.error);
