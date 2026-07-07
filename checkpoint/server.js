#!/usr/bin/env node

/**
 * Checkpoint MCP Server for Codex
 *
 * Local, git-independent file snapshots so a solo dev / vibecoder can
 * experiment freely and roll back instantly. Snapshots are stored outside
 * the project (default ~/.codex/memories/checkpoints/<project-slug>/).
 *
 * Tools: checkpoint_create, checkpoint_list, checkpoint_restore,
 *        checkpoint_diff, checkpoint_delete
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

const ROOT =
  process.env.CHECKPOINT_DIR ||
  path.join(os.homedir(), ".ai-shared-memory", "checkpoints");

const DEFAULT_IGNORE = new Set([
  "node_modules", ".git", ".next", "dist", "build", "target", ".venv",
  "venv", "__pycache__", ".cache", ".turbo", "coverage", ".DS_Store",
  ".codex", "vendor", ".idea", ".gradle",
]);
const MAX_FILE_BYTES = 2_000_000;
const MAX_FILES = 4000;

function slug(dir) {
  const resolved = path.resolve(dir || process.cwd());
  const base = path.basename(resolved) || "root";
  const hash = crypto.createHash("sha1").update(resolved).digest("hex").slice(0, 8);
  return `${base.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 40)}-${hash}`;
}

function nowIso() { return new Date().toISOString(); }
function cpId() {
  return new Date().toISOString().replace(/[:.]/g, "").slice(0, 15) + "-" + crypto.randomBytes(2).toString("hex");
}

async function walk(base, rel = "", out = []) {
  const abs = path.join(base, rel);
  let entries;
  try { entries = await fs.readdir(abs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (DEFAULT_IGNORE.has(e.name)) continue;
    const childRel = path.join(rel, e.name);
    if (e.isDirectory()) {
      await walk(base, childRel, out);
    } else if (e.isFile()) {
      if (out.length >= MAX_FILES) break;
      out.push(childRel);
    }
  }
  return out;
}

function hashContent(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

class CheckpointServer {
  constructor() {
    this.server = new Server(
      { name: "checkpoint", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    this.setup();
  }

  paths(dir) {
    const s = slug(dir);
    const projectDir = path.join(ROOT, s);
    return {
      slug: s,
      root: path.resolve(dir || process.cwd()),
      projectDir,
      manifest: path.join(projectDir, "manifest.json"),
      snaps: path.join(projectDir, "snapshots"),
    };
  }

  async loadManifest(p) {
    try { return JSON.parse(await fs.readFile(p.manifest, "utf8")); }
    catch { return { project: p.slug, root: p.root, checkpoints: {} }; }
  }
  async saveManifest(p, m) {
    await fs.mkdir(p.projectDir, { recursive: true });
    await fs.writeFile(p.manifest, JSON.stringify(m, null, 2));
  }

  setup() {
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: "checkpoint_create",
          description: "Snapshot all text files in a project directory (git-independent). Use before risky/experimental changes so you can roll back.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              label: { type: "string", description: "Short label for this checkpoint" },
            },
          },
        },
        {
          name: "checkpoint_list",
          description: "List checkpoints for a project (newest first).",
          inputSchema: {
            type: "object",
            properties: { dir: { type: "string", description: "Project directory (defaults to CWD)" } },
          },
        },
        {
          name: "checkpoint_restore",
          description: "Restore project files to a checkpoint. By default only restores changed/deleted files; pass clean=true to also remove files added since the checkpoint.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Checkpoint id" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              clean: { type: "boolean", description: "Delete files created after the checkpoint", default: false },
            },
            required: ["id"],
          },
        },
        {
          name: "checkpoint_diff",
          description: "Summarize what changed between a checkpoint and current files (added/modified/deleted lists).",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Checkpoint id" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
            },
            required: ["id"],
          },
        },
        {
          name: "checkpoint_delete",
          description: "Delete a checkpoint by id.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Checkpoint id" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
            },
            required: ["id"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      try {
        switch (name) {
          case "checkpoint_create": return await this.create(args || {});
          case "checkpoint_list": return await this.list(args || {});
          case "checkpoint_restore": return await this.restore(args || {});
          case "checkpoint_diff": return await this.diff(args || {});
          case "checkpoint_delete": return await this.del(args || {});
          default: throw new Error(`Unknown tool: ${name}`);
        }
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    });
  }

  async create({ dir, label }) {
    const p = this.paths(dir);
    const files = await walk(p.root);
    const id = cpId();
    const snapDir = path.join(p.snaps, id);
    await fs.mkdir(snapDir, { recursive: true });

    const records = {};
    let skipped = 0, stored = 0;
    for (const rel of files) {
      const abs = path.join(p.root, rel);
      let stat;
      try { stat = await fs.stat(abs); } catch { continue; }
      if (stat.size > MAX_FILE_BYTES) { skipped++; continue; }
      const buf = await fs.readFile(abs);
      if (buf.includes(0)) { skipped++; continue; } // skip binary
      const h = hashContent(buf);
      const dest = path.join(snapDir, h);
      await fs.writeFile(dest, buf).catch(() => {});
      records[rel] = { hash: h, size: stat.size };
      stored++;
    }

    const manifest = await this.loadManifest(p);
    manifest.checkpoints[id] = { id, label: label || "", created: nowIso(), files: records, stored, skipped };
    await this.saveManifest(p, manifest);
    return { content: [{ type: "text", text: `Checkpoint ${id} created for ${p.slug}\nLabel: ${label || "(none)"}\nFiles stored: ${stored}${skipped ? `, skipped(binary/large): ${skipped}` : ""}` }] };
  }

  async list({ dir }) {
    const p = this.paths(dir);
    const m = await this.loadManifest(p);
    const cps = Object.values(m.checkpoints || {}).sort((a, b) => (a.created < b.created ? 1 : -1));
    if (!cps.length) return { content: [{ type: "text", text: `No checkpoints for ${p.slug} yet.` }] };
    const lines = cps.map((c) => `- ${c.id}  ${c.label ? `"${c.label}" ` : ""}(${c.stored} files) — ${c.created}`);
    return { content: [{ type: "text", text: `Checkpoints in ${p.slug} (${cps.length}):\n${lines.join("\n")}` }] };
  }

  async computeDiff(p, cp) {
    const current = await walk(p.root);
    const currentSet = new Set(current);
    const added = [], modified = [], deleted = [];
    for (const rel of current) {
      if (!cp.files[rel]) { added.push(rel); continue; }
      const abs = path.join(p.root, rel);
      try {
        const buf = await fs.readFile(abs);
        if (hashContent(buf) !== cp.files[rel].hash) modified.push(rel);
      } catch { /* ignore */ }
    }
    for (const rel of Object.keys(cp.files)) {
      if (!currentSet.has(rel)) deleted.push(rel);
    }
    return { added, modified, deleted };
  }

  async diff({ id, dir }) {
    const p = this.paths(dir);
    const m = await this.loadManifest(p);
    const cp = m.checkpoints?.[id];
    if (!cp) throw new Error(`Checkpoint ${id} not found in ${p.slug}`);
    const d = await this.computeDiff(p, cp);
    const fmt = (arr) => arr.length ? arr.slice(0, 100).map((x) => `  ${x}`).join("\n") : "  (none)";
    return { content: [{ type: "text", text:
      `Diff vs ${id} (${cp.created}) in ${p.slug}:\n` +
      `Added (${d.added.length}):\n${fmt(d.added)}\n` +
      `Modified (${d.modified.length}):\n${fmt(d.modified)}\n` +
      `Deleted (${d.deleted.length}):\n${fmt(d.deleted)}` }] };
  }

  async restore({ id, dir, clean = false }) {
    const p = this.paths(dir);
    const m = await this.loadManifest(p);
    const cp = m.checkpoints?.[id];
    if (!cp) throw new Error(`Checkpoint ${id} not found in ${p.slug}`);
    const snapDir = path.join(p.snaps, id);
    let restored = 0, removed = 0;
    for (const [rel, rec] of Object.entries(cp.files)) {
      const src = path.join(snapDir, rec.hash);
      const dest = path.join(p.root, rel);
      try {
        const buf = await fs.readFile(src);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, buf);
        restored++;
      } catch { /* ignore */ }
    }
    if (clean) {
      const d = await this.computeDiff(p, cp);
      for (const rel of d.added) {
        await fs.unlink(path.join(p.root, rel)).catch(() => {});
        removed++;
      }
    }
    return { content: [{ type: "text", text: `Restored ${restored} files from ${id}${clean ? `, removed ${removed} newer files` : ""} in ${p.slug}` }] };
  }

  async del({ id, dir }) {
    const p = this.paths(dir);
    const m = await this.loadManifest(p);
    if (!m.checkpoints?.[id]) throw new Error(`Checkpoint ${id} not found in ${p.slug}`);
    await fs.rm(path.join(p.snaps, id), { recursive: true, force: true }).catch(() => {});
    delete m.checkpoints[id];
    await this.saveManifest(p, m);
    return { content: [{ type: "text", text: `Deleted checkpoint ${id} from ${p.slug}` }] };
  }

  async run() {
    const t = new StdioServerTransport();
    await this.server.connect(t);
    console.error(`Checkpoint MCP server running on stdio (store: ${ROOT})`);
  }
}

new CheckpointServer().run().catch(console.error);
