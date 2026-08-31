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
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { embed, embedOne, cosine, embeddingConfig } from "./embedding.js";
import { rerank, rerankConfig } from "./rerank.js";
import { deterministicEnabled } from "./env.js";
import { ensureGraphState, resolveLink, loadNoteBody } from "./graph.js";
import { loadGlobalNotes } from "./global-index.js";
import { findDuplicateCandidates } from "./dedup.js";
import { computeStats, formatText, formatJson } from "../lib/stats.js";
import { broadcastSwarmEvent, getSwarmTimeline } from "./swarm.js";
import { runAutoIndexer } from "./auto-indexer.js";

const VAULT_ROOT =
  process.env.MEMORY_VAULT_DIR ||
  path.join(os.homedir(), ".ai-shared-memory", "vault");

const MAX_CONTENT = 200_000;
const MAX_TITLE = 200;
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "to",
  "of", "in", "on", "at", "by", "is", "are", "was", "were", "be", "this",
  "that", "it", "as", "with", "from", "we", "i", "you", "he", "she", "they",
  "not", "no", "do", "did", "does", "can", "will", "so", "my", "our", "your",
]);

export function projectSlug(dir) {
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

export function parseFrontmatter(raw) {
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

function graphBoost(note, queryTokens) {
  let score = 0;
  for (const link of note.links || []) {
    for (const token of queryTokens) {
      if (String(link.ref || "").toLowerCase().includes(token)) score += 0.05;
    }
  }
  return Math.min(0.15, score);
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

  // Ensure an Obsidian-friendly workspace exists so the vault can be opened
  // directly in the Obsidian app (graph view, tag pages, MOC navigation).
  async ensureObsidianFolder(p) {
    const obsDir = path.join(p.projectDir, ".obsidian");
    try { await fs.access(obsDir); return; } catch {}
    await fs.mkdir(obsDir, { recursive: true });
    await fs.writeFile(path.join(obsDir, "app.json"), JSON.stringify({
      alwaysUpdateLinks: true,
      newLinkFormat: "shortest",
      useMarkdownLinks: false,
      showViewHeader: true,
    }, null, 2));
    await fs.writeFile(path.join(obsDir, "workspace.json"), JSON.stringify({
      _comment: "Auto-managed by codex-dev-mcp-suite (project-memory).",
    }, null, 2));
  }

  // Build an Obsidian-style Map of Content (MOC) listing every note, its
  // outgoing links, backlinks, and a #tag index. Refreshed on save/delete.
  async writeMoc(p, index) {
    const notes = Object.values(index.notes || {})
      .sort((a, b) => (a.created < b.created ? 1 : -1));
    if (notes.length === 0) return;
    const tagMap = new Map();
    for (const n of notes) {
      for (const t of n.tags || []) {
        if (!tagMap.has(t)) tagMap.set(t, []);
        tagMap.get(t).push(n);
      }
    }
    const lines = [
      "# MOC — Map of Content",
      "",
      `> Auto-generated by project-memory for project \`${p.slug}\`. Do not edit by hand; it is regenerated on every save/delete.`,
      "",
      `**${notes.length} notes**`,
      "",
      "## Notes",
    ];
    for (const n of notes) {
      const link = `[[${n.title}]]`;
      const tags = (n.tags || []).length ? `  #${(n.tags || []).join(" #")}` : "";
      lines.push(`- ${link} — *${n.kind || "note"}*${tags}`);
    }
    lines.push("", "## By tag");
    if (tagMap.size === 0) lines.push("- (no tags yet)");
    for (const [tag, ns] of [...tagMap.entries()].sort()) {
      lines.push(`- #${tag}: ${ns.map((n) => `[[${n.title}]]`).join(", ")}`);
    }
    lines.push("", "## Graph (backlinks)");
    for (const n of notes) {
      const bl = (n.backlinks || []).map((b) => `[[${b.title}]]`).join(", ");
      if (bl) lines.push(`- [[${n.title}]] <- ${bl}`);
    }
    lines.push("");
    await fs.writeFile(path.join(p.projectDir, "MOC.md"), lines.join("\n"));
    // Also emit a standalone #tag index page per tag (Obsidian-style tag pages).
    await this.writeTagPages(p, tagMap);
  }

  // Emit one `tags/<tag>.md` page per tag, listing all notes carrying it.
  async writeTagPages(p, tagMap) {
    const tagDir = path.join(p.projectDir, "tags");
    await fs.mkdir(tagDir, { recursive: true });
    for (const [tag, ns] of tagMap.entries()) {
      const body = [
        `# Tag: ${tag}`,
        "",
        ns.map((n) => `- [[${n.title}]] — *${n.kind || "note"}*`).join("\n"),
        "",
      ].join("\n");
      await fs.writeFile(path.join(tagDir, `${String(tag).replace(/[^a-zA-Z0-9._-]/g, "-")}.md`), body);
    }
    // prune tag pages with no notes left
    let files = [];
    try { files = await fs.readdir(tagDir); } catch { return; }
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const t = f.slice(0, -3);
      if (!tagMap.has(t)) await fs.unlink(path.join(tagDir, f)).catch(() => {});
    }
  }

  // Export the note graph (nodes + directed edges) for external graph views.
  buildGraph(index) {
    const nodes = Object.values(index.notes || {}).map((n) => ({
      id: n.id, title: n.title, kind: n.kind || "note", tags: n.tags || [],
    }));
    const edges = [];
    for (const n of Object.values(index.notes || {})) {
      for (const link of n.links || []) {
        edges.push({ from: n.id, raw: link.raw, ref: link.ref, kind: link.kind });
      }
    }
    return { nodes, edges };
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
              aliases: { type: "array", items: { type: "string" }, description: "Optional Obsidian-style aliases for the note (alt titles wikilinks can reference)" },
              created: { type: "string", description: "Optional ISO timestamp to backdate the note (e.g. original session time)" },
            },
            required: ["title", "content"],
          },
        },
        {
          name: "memory_recall",
          description:
            "Retrieve the most relevant saved notes for a query. Falls back gracefully: semantic -> keyword -> LLM rerank. Set mode to control behavior: 'auto' (default), 'semantic' (require embedding), 'keyword' (skip embedding).",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "What you need context about" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              limit: { type: "number", description: "Max notes to return", default: 5 },
              full: { type: "boolean", description: "Return full bodies instead of excerpts", default: false },
              mode: { type: "string", enum: ["auto", "semantic", "keyword"], default: "auto", description: "Retrieval mode: 'auto' (default, smart fallback), 'semantic' (require embedding), 'keyword' (skip embedding)" },
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
          name: "memory_link",
          description: "Resolve wiki-style note links and show backlinks for a note.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Note id to inspect" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              include_unresolved: { type: "boolean", description: "Include unresolved links in output", default: true },
            },
            required: ["id"],
          },
        },
        {
          name: "memory_global_recall",
          description: "Recall relevant notes across projects with same-project bias and graceful keyword fallback.",
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
          name: "memory_dedup",
          description: "Find likely duplicate notes and suggest non-destructive merges.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              threshold: { type: "number", description: "Duplicate threshold", default: 0.9 },
              scope: { type: "string", enum: ["project", "global"], description: "Dedup scope", default: "project" },
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
        {
          name: "memory_moc",
          description: "Generate / refresh the Obsidian-style Map of Content (MOC.md) for the project: lists every note with wikilinks, a #tag index, and backlink graph. Run after saves, or on demand to open the vault in Obsidian.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
            },
          },
        },
        {
          name: "memory_graph",
          description: "Export the note graph (nodes + directed edges from [[wikilinks]]) as JSON, for external graph views or analysis. Backlinks are resolved via graph state.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
            },
          },
        },
        {
          name: "memory_broadcast",
          description: "Broadcast an event/finding to the real-time multi-agent swarm stream for peer subagents in the workspace.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              eventType: { type: "string", description: "Event type: 'finding' | 'bug' | 'decision' | 'status'", default: "finding" },
              topic: { type: "string", description: "Topic/category" },
              payload: { type: "object", description: "Structured event payload" },
              agentName: { type: "string", description: "Name/role of emitting agent", default: "agent" },
            },
            required: ["topic"],
          },
        },
        {
          name: "memory_swarm_timeline",
          description: "Query real-time multi-agent swarm event stream in the shared workspace.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              limit: { type: "number", description: "Max events to return", default: 20 },
              eventType: { type: "string", description: "Filter by eventType" },
            },
          },
        },
        {
          name: "memory_import_session",
          description: "Ingest and extract key decisions, bugs solved, and architecture notes from a conversation or session digest into permanent Markdown memory notes.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Title for the imported memory snapshot" },
              sessionText: { type: "string", description: "Raw transcript or summary text of the session" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              tags: { type: "array", items: { type: "string" }, description: "Tags for the notes" },
            },
            required: ["title", "sessionText"],
          },
        },
        {
          name: "memory_auto_index",
          description: "Run autonomous background observer to inspect git commits, branch switches, file modifications, and chat session transcripts to auto-derive project notes and architectural decisions.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              dryRun: { type: "boolean", description: "Preview derived knowledge without saving", default: false },
              scanSessions: { type: "boolean", description: "Scan recent chat session logs/transcripts to auto-extract architectural decisions and key discussions", default: true },
              sessionDir: { type: "string", description: "Optional custom directory containing session JSONL logs" },
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
          case "memory_link": return await this.link(args || {});
          case "memory_global_recall": return await this.globalRecall(args || {});
          case "memory_dedup": return await this.dedup(args || {});
          case "memory_stats": return await this.stats(args || {});
          case "memory_moc": return await this.moc(args || {});
          case "memory_graph": return await this.graph(args || {});
          case "memory_broadcast": return await this.broadcast(args || {});
          case "memory_swarm_timeline": return await this.swarmTimeline(args || {});
          case "memory_auto_index": return await this.autoIndex(args || {});
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

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));

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

  async save({ title, content, dir, tags, kind = "note", aliases, created: createdArg }) {
    title = limit(title, "title", MAX_TITLE);
    content = limit(content, "content", MAX_CONTENT);
    const tagList = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
    const aliasList = Array.isArray(aliases) ? aliases.map((t) => String(t).trim()).filter(Boolean) : [];
    const p = this.paths(dir);
    await fs.mkdir(p.notesDir, { recursive: true });

    const id = genId();
    const created = (createdArg && /^\d{4}-\d{2}-\d{2}/.test(String(createdArg))) ? String(createdArg) : nowIso();
    const meta = { id, title, kind, tags: tagList, aliases: aliasList, created, dir: path.resolve(dir || process.cwd()) };
    const file = path.join(p.notesDir, `${id}.md`);
    await fs.writeFile(file, buildFrontmatter(meta) + `# ${title}\n\n${content}\n`);

    const index = await this.loadIndex(p);
    const keywords = [...new Set([...tokenize(title), ...tokenize(content), ...tagList.map((t) => t.toLowerCase())])];
    const note = { id, title, kind, tags: tagList, aliases: aliasList, created, keywords, file: path.relative(p.projectDir, file) };

    const vec = await embedOne(`${title}\n\n${content}`);
    let embedded = false;
    if (vec) { note.embedding = vec; note.embModel = embeddingConfig().model; embedded = true; }

    index.notes[id] = note;
    await this.saveIndex(p, index);
    await this.ensureObsidianFolder(p);
    // Resolve [[wikilinks]] + backlinks immediately so the graph is fresh on save.
    const ensured = await ensureGraphState({
      vaultRoot: VAULT_ROOT,
      projectDir: p.projectDir,
      slug: p.slug,
      index,
      noteLoader: loadNoteBody,
    });
    if (ensured.changed) await this.saveIndex(p, ensured.index);
    await this.writeMoc(p, ensured.index);

    return { content: [{ type: "text", text: `Saved note ${id} → ${p.slug}\nFile: ${file}\nKeywords indexed: ${keywords.length}${embedded ? " (semantic embedding stored)" : " (keyword-only; embeddings unavailable)"}\nMOC refreshed: ${path.join(p.projectDir, "MOC.md")}` }] };
  }

  async recall({ query, dir, limit: lim = 5, full = false, mode: requestedMode = "auto" }) {
    query = limit(query, "query", 2000);
    const p = this.paths(dir);
    const index = await this.loadIndex(p);
    const ensured = await ensureGraphState({
      vaultRoot: VAULT_ROOT,
      projectDir: p.projectDir,
      slug: p.slug,
      index,
      noteLoader: loadNoteBody,
    });
    if (ensured.changed) await this.saveIndex(p, ensured.index);
    const notes = Object.values(ensured.index.notes || {});
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

    // Tier 2.1: respect requested mode. "auto" = smart fallback.
    let mode = deterministicEnabled() ? "deterministic" : "keyword";
    const useEmbed = requestedMode !== "keyword" && !deterministicEnabled();
    const qVec = useEmbed ? await embedOne(query) : null;
    const haveEmb = qVec && notes.some((n) => Array.isArray(n.embedding));

    // Tier 2.1: "semantic" requested but unavailable -> error
    if (requestedMode === "semantic" && !haveEmb) {
      return { content: [{ type: "text", text: `memory_recall(mode=semantic) requested but no embeddings available. Set MCP_EMBED_API_KEY + MCP_EMBED_MODEL, or omit mode for keyword fallback.` }], isError: true };
    }

    let scored;
    if (haveEmb) {
      mode = "semantic";
      const maxKw = Math.max(1, ...notes.map(kw));
      scored = notes.map((n) => {
        const sim = Array.isArray(n.embedding) ? cosine(qVec, n.embedding) : 0;
        const kwNorm = kw(n) / maxKw;
        const score = 0.8 * sim + 0.2 * kwNorm + graphBoost(n, [...qTokens]);
        return { n, score, sim };
      }).filter((x) => x.score > 0.05)
        .sort((a, b) => b.score - a.score || (a.n.created < b.n.created ? 1 : -1))
        .slice(0, Math.max(1, Math.min(20, lim)));
    } else {
      const want = Math.max(1, Math.min(20, lim));
      const kwRanked = notes.map((n) => ({ n, score: kw(n) + graphBoost(n, [...qTokens]) }))
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
    // Tier 2.2: annotate mode with rerank indicator
    const isReranked = rerankConfig().enabled && blocks.length > 1;
    const displayMode = mode === "semantic" && isReranked ? "semantic+rerank"
      : mode === "keyword" && isReranked ? "keyword+rerank"
      : mode;
    return { content: [{ type: "text", text: `Recall for "${query}" in ${p.slug} [${displayMode}]:\n\n${blocks.join("\n\n---\n\n")}` }] };
  }

  async dedup({ dir, threshold = 0.9, scope = "project" }) {
    const p = this.paths(dir);
    const rows = await loadGlobalNotes(VAULT_ROOT);
    const filtered = scope === "project" ? rows.filter((row) => row.slug === p.slug) : rows;
    const withBodies = await Promise.all(filtered.map(async ({ slug, note }) => {
      const raw = await fs.readFile(path.join(VAULT_ROOT, slug, note.file), "utf8").catch(() => "");
      const { body } = parseFrontmatter(raw);
      return { slug, note, body };
    }));
    const pairs = findDuplicateCandidates({ rows: withBodies, threshold });
    if (!pairs.length) {
      return { content: [{ type: "text", text: `No duplicate suggestions above ${threshold} in ${scope} scope.` }] };
    }
    const lines = [`Duplicate suggestions [threshold=${threshold}, scope=${scope}]:`, ""];
    for (const pair of pairs) {
      lines.push(`- suggested merge: [${pair.left.slug}] ${pair.left.note.title} <-> [${pair.right.slug}] ${pair.right.note.title} (score=${pair.score.toFixed(3)})`);
      lines.push(`  reasons: ${pair.reasons.join(", ")}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  async globalRecall({ query, dir, limit: lim = 5, full = false }) {
    query = limit(query, "query", 2000);
    const p = this.paths(dir);
    const currentIndex = await this.loadIndex(p);
    const ensured = await ensureGraphState({
      vaultRoot: VAULT_ROOT,
      projectDir: p.projectDir,
      slug: p.slug,
      index: currentIndex,
      noteLoader: loadNoteBody,
    });
    if (ensured.changed) await this.saveIndex(p, ensured.index);
    const rows = await loadGlobalNotes(VAULT_ROOT);
    const qTokens = new Set(tokenize(query));
    const qVec = deterministicEnabled() ? null : await embedOne(query);
    const haveEmbeddings = !!(qVec && rows.some((row) => Array.isArray(row.note.embedding)));

    const scored = rows.map(({ slug, note }) => {
      let kwScore = 0;
      for (const keyword of note.keywords || []) if (qTokens.has(keyword)) kwScore += 1;
      for (const word of tokenize(note.title)) if (qTokens.has(word)) kwScore += 2;
      const sameProjectBoost = slug === p.slug ? 0.25 : 0;
      const sim = haveEmbeddings && Array.isArray(note.embedding) ? cosine(qVec, note.embedding) : 0;
      const score = (haveEmbeddings ? (0.8 * sim) : 0) + (0.2 * kwScore) + sameProjectBoost + graphBoost(note, [...qTokens]);
      return { slug, note, sim, score };
    }).filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || (a.note.created < b.note.created ? 1 : -1))
      .slice(0, Math.max(1, Math.min(20, lim)));

    if (scored.length === 0) {
      return { content: [{ type: "text", text: `No relevant global memories for "${query}". Try memory_list or memory_recall.` }] };
    }

    const mode = haveEmbeddings ? "semantic+graph" : "keyword+graph";
    const blocks = await Promise.all(scored.map(async ({ slug, note, sim, score }) => {
      const raw = await fs.readFile(path.join(VAULT_ROOT, slug, note.file), "utf8").catch(() => "");
      const { body } = parseFrontmatter(raw);
      const text = full ? body.trim() : body.trim().split("\n").slice(0, 12).join("\n");
      return `### ${note.title}  ([${slug}], ${haveEmbeddings ? `sim:${sim.toFixed(3)}` : `score:${score.toFixed(2)}`})\n${text}`;
    }));
    return { content: [{ type: "text", text: `Global recall for "${query}" [${mode}]:\n\n${blocks.join("\n\n---\n\n")}` }] };
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
    await this.writeMoc(p, index);
    return { content: [{ type: "text", text: `Deleted note ${id} from ${p.slug}` }] };
  }

  async link({ id, dir, include_unresolved = true }) {
    id = limit(id, "id", 100);
    const p = this.paths(dir);
    const index = await this.loadIndex(p);
    const note = index.notes?.[id];
    if (!note) throw new Error(`Note ${id} not found in ${p.slug}`);

    const ensured = await ensureGraphState({
      vaultRoot: VAULT_ROOT,
      projectDir: p.projectDir,
      slug: p.slug,
      index,
      noteLoader: loadNoteBody,
    });
    if (ensured.changed) await this.saveIndex(p, ensured.index);

    const current = ensured.index.notes[id];
    const links = [];
    for (const link of current.links || []) {
      const resolved = await resolveLink({
        vaultRoot: VAULT_ROOT,
        currentSlug: p.slug,
        ref: link.ref,
        project: link.project,
        kind: link.kind,
      });
      if (resolved.status !== "missing" || include_unresolved) links.push({ link, resolved });
    }

    const lines = [
      `Links for ${current.title} (${current.id})`,
      "",
      "Outgoing:",
      ...links.map(({ link, resolved }) => `- ${link.raw} -> ${resolved.status}${resolved.match ? ` (${resolved.match.title})` : ""}`),
      "",
      "Backlinks:",
      ...((current.backlinks || []).length ? current.backlinks.map((b) => `- ${b.title} (${b.id})`) : ["- none"]),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
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
              : path.join(os.homedir(), ".ai-shared-memory"));
    const stats = computeStats({ root, topLimit: top });
    const text = json ? formatJson(stats) : formatText(stats);
    return { content: [{ type: "text", text }] };
  }

  async moc({ dir } = {}) {
    const p = this.paths(dir);
    await this.ensureObsidianFolder(p);
    const index = await this.loadIndex(p);
    await this.writeMoc(p, index);
    const mocFile = path.join(p.projectDir, "MOC.md");
    const count = Object.keys(index.notes || {}).length;
    return { content: [{ type: "text", text: `MOC refreshed for ${p.slug}: ${count} notes → ${mocFile}\nOpen the project folder in Obsidian to see the graph + tag pages.` }] };
  }

  async graph({ dir } = {}) {
    const p = this.paths(dir);
    const index = await this.loadIndex(p);
    const ensured = await ensureGraphState({
      vaultRoot: VAULT_ROOT,
      projectDir: p.projectDir,
      slug: p.slug,
      index,
      noteLoader: loadNoteBody,
    });
    if (ensured.changed) await this.saveIndex(p, ensured.index);
    const g = this.buildGraph(ensured.index);
    return { content: [{ type: "text", text: JSON.stringify(g, null, 2) }] };
  }

  async broadcast({ dir, eventType = "finding", topic, payload, agentName = "agent" } = {}) {
    const p = this.paths(dir);
    const event = await broadcastSwarmEvent(p.projectDir, { eventType, topic, payload, agentName });
    return { content: [{ type: "text", text: `Broadcasted swarm event ${event.id} [${event.eventType}] topic: "${topic}" by ${agentName}` }] };
  }

  async swarmTimeline({ dir, limit = 20, eventType = null } = {}) {
    const p = this.paths(dir);
    const events = await getSwarmTimeline(p.projectDir, { limit, eventType });
    if (!events.length) {
      return { content: [{ type: "text", text: `No swarm events recorded yet for project ${p.slug}.` }] };
    }
    const lines = [`# Swarm Stream: ${p.slug}`, `Total Events: ${events.length}`, ``];
    for (const e of events) {
      lines.push(`- **[${e.timestamp}] (${e.agentName})** \`${e.eventType}\` — **${e.topic}**`);
      if (e.payload && Object.keys(e.payload).length > 0) {
        lines.push(`  \`\`\`json\n  ${JSON.stringify(e.payload)}\n  \`\`\``);
      }
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  async autoIndex({ dir, dryRun = false, scanSessions = true, sessionDir = null } = {}) {
    const p = this.paths(dir);
    const res = await runAutoIndexer(dir, { dryRun, scanSessions, sessionDir });
    if (!dryRun && res.summaryText) {
      await this.save({
        title: `Auto-Index ${new Date().toISOString().substring(0, 10)} (${res.branch})`,
        content: res.summaryText,
        dir,
        tags: ["auto-index", "git", "session-digest"],
        kind: "auto-derived"
      });
      for (const note of (res.notesCreated || [])) {
        await this.save({
          title: note.title,
          content: note.content,
          dir,
          tags: note.tags || ["session-digest", "auto-derived"],
          kind: "session-digest"
        });
      }
    }
    return { content: [{ type: "text", text: res.summaryText + (dryRun ? "\n\n(Dry Run — note not saved)" : "\n\n(Saved to project memory vault)") }] };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Project Memory MCP server running on stdio (vault: ${VAULT_ROOT})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = new ProjectMemoryServer();
  server.run().catch(console.error);
}

export { ProjectMemoryServer };
