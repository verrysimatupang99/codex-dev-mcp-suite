#!/usr/bin/env node

/**
 * Context Pack MCP Server for Codex
 *
 * Builds a compact, token-budgeted "briefing" of a project so a fresh
 * session can get oriented without re-pasting files or blowing the context
 * window. Detects stack, shows a pruned tree, surfaces key files, and
 * extracts top-level symbols (functions/classes/exports) heuristically.
 *
 * Tools: pack_overview, pack_tree, pack_outline, pack_search
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

const IGNORE = new Set([
  "node_modules", ".git", ".next", "dist", "build", "target", ".venv",
  "venv", "__pycache__", ".cache", ".turbo", "coverage", ".DS_Store",
  "vendor", ".idea", ".gradle", "out", ".parcel-cache", ".pytest_cache",
]);
const KEY_FILES = [
  "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml",
  "go.mod", "pom.xml", "build.gradle", "composer.json", "Gemfile",
  "README.md", "readme.md", "Makefile", "Dockerfile", "docker-compose.yml",
  "tsconfig.json", "next.config.js", "vite.config.ts", "vite.config.js",
  ".env.example", "AGENTS.md", "CLAUDE.md", "RTK.md",
];
const CODE_EXT = new Set([".js", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php", ".c", ".cpp", ".h", ".sh"]);
const MAX_FILE_BYTES = 1_500_000;

function resolveDir(dir) { return path.resolve(dir || process.cwd()); }

async function walk(base, rel = "", out = [], depth = 0, maxDepth = 8) {
  if (depth > maxDepth) return out;
  let entries;
  try { entries = await fs.readdir(path.join(base, rel), { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (IGNORE.has(e.name) || e.name.startsWith(".") && e.isDirectory() && e.name !== ".github") continue;
    const childRel = path.join(rel, e.name);
    if (e.isDirectory()) { out.push({ rel: childRel, dir: true, depth }); await walk(base, childRel, out, depth + 1, maxDepth); }
    else if (e.isFile()) out.push({ rel: childRel, dir: false, depth });
  }
  return out;
}

async function detectStack(root, files) {
  const names = new Set(files.filter((f) => !f.dir).map((f) => path.basename(f.rel)));
  const stack = [];
  if (names.has("package.json")) {
    stack.push("Node/JS");
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [d, label] of [["next", "Next.js"], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"], ["express", "Express"], ["fastify", "Fastify"], ["typescript", "TypeScript"], ["tailwindcss", "Tailwind"], ["prisma", "Prisma"], ["vite", "Vite"]]) {
        if (deps[d]) stack.push(label);
      }
    } catch { /* ignore */ }
  }
  if (names.has("pyproject.toml") || names.has("requirements.txt")) stack.push("Python");
  if (names.has("Cargo.toml")) stack.push("Rust");
  if (names.has("go.mod")) stack.push("Go");
  if (names.has("pom.xml") || names.has("build.gradle")) stack.push("Java/JVM");
  if (names.has("composer.json")) stack.push("PHP");
  if (names.has("Gemfile")) stack.push("Ruby");
  if (names.has("Dockerfile") || names.has("docker-compose.yml")) stack.push("Docker");
  return [...new Set(stack)];
}

function extractSymbols(content, ext) {
  const syms = [];
  const lines = content.split("\n");
  const patterns = [
    /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/,
    /^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=/,
    /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/,
    /^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)/,
    /^\s*class\s+([A-Za-z0-9_]+)/,
    /^\s*def\s+([A-Za-z0-9_]+)/,
    /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/,
    /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/,
    /^\s*(?:public|private|protected)\s+(?:static\s+)?[A-Za-z0-9_<>\[\]]+\s+([A-Za-z0-9_]+)\s*\(/,
  ];
  for (let i = 0; i < lines.length; i++) {
    for (const re of patterns) {
      const m = lines[i].match(re);
      if (m) { syms.push({ name: m[1], line: i + 1 }); break; }
    }
    if (syms.length >= 80) break;
  }
  return syms;
}

class ContextPackServer {
  constructor() {
    this.server = new Server({ name: "context-pack", version: "1.0.0" }, { capabilities: { tools: {} } });
    this.setup();
  }

  setup() {
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: "pack_overview",
          description: "Build a compact project briefing: detected stack, key config files (with short excerpts), top-level dirs, and file counts. Call at session start to get oriented cheaply.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              include_readme: { type: "boolean", description: "Include README excerpt", default: true },
            },
          },
        },
        {
          name: "pack_tree",
          description: "Print a pruned directory tree (ignores node_modules/.git/build dirs).",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              max_depth: { type: "number", description: "Max depth", default: 3 },
              max_entries: { type: "number", description: "Max lines", default: 200 },
            },
          },
        },
        {
          name: "pack_outline",
          description: "Extract top-level symbols (functions/classes/exports) from a source file without dumping the whole file.",
          inputSchema: {
            type: "object",
            properties: {
              file: { type: "string", description: "Path to source file (absolute or relative to dir)" },
              dir: { type: "string", description: "Base directory (defaults to CWD)" },
            },
            required: ["file"],
          },
        },
        {
          name: "pack_search",
          description: "Find files whose name or path matches a substring (fast, ignores build dirs). Returns relative paths.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Substring to match in path" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              limit: { type: "number", description: "Max results", default: 50 },
            },
            required: ["query"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      try {
        switch (name) {
          case "pack_overview": return await this.overview(args || {});
          case "pack_tree": return await this.tree(args || {});
          case "pack_outline": return await this.outline(args || {});
          case "pack_search": return await this.search(args || {});
          default: throw new Error(`Unknown tool: ${name}`);
        }
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    });
  }

  async overview({ dir, include_readme = true }) {
    const root = resolveDir(dir);
    const all = await walk(root, "", [], 0, 6);
    const fileCount = all.filter((f) => !f.dir).length;
    const dirCount = all.filter((f) => f.dir).length;
    const stack = await detectStack(root, all);

    const topDirs = all.filter((f) => f.dir && f.depth === 0).map((f) => f.rel);
    const present = KEY_FILES.filter((k) => all.some((f) => !f.dir && f.rel === k || path.basename(f.rel) === k && f.depth === 0));

    const sections = [];
    sections.push(`# Project briefing: ${path.basename(root)}`);
    sections.push(`Path: ${root}`);
    sections.push(`Stack: ${stack.length ? stack.join(", ") : "unknown"}`);
    sections.push(`Files: ${fileCount} | Dirs: ${dirCount}`);
    sections.push(`Top-level dirs: ${topDirs.length ? topDirs.join(", ") : "(none)"}`);
    sections.push(`Key files: ${present.length ? present.join(", ") : "(none)"}`);

    // package.json scripts
    if (present.includes("package.json")) {
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
        if (pkg.scripts) sections.push(`\n## Scripts\n` + Object.entries(pkg.scripts).map(([k, v]) => `- ${k}: ${v}`).join("\n"));
      } catch { /* ignore */ }
    }

    if (include_readme) {
      const readme = present.find((k) => k.toLowerCase() === "readme.md");
      if (readme) {
        try {
          const txt = await fs.readFile(path.join(root, readme), "utf8");
          sections.push(`\n## README (excerpt)\n` + txt.trim().split("\n").slice(0, 25).join("\n"));
        } catch { /* ignore */ }
      }
    }

    return { content: [{ type: "text", text: sections.join("\n") }] };
  }

  async tree({ dir, max_depth = 3, max_entries = 200 }) {
    const root = resolveDir(dir);
    const all = await walk(root, "", [], 0, Math.max(1, Math.min(10, max_depth)));
    const filtered = all.filter((f) => f.depth < max_depth).slice(0, Math.max(10, Math.min(1000, max_entries)));
    const lines = filtered.map((f) => `${"  ".repeat(f.depth)}${f.dir ? "📁 " : ""}${path.basename(f.rel)}${f.dir ? "/" : ""}`);
    return { content: [{ type: "text", text: `Tree of ${root} (depth ${max_depth}):\n${lines.join("\n")}${all.length > filtered.length ? `\n... (${all.length - filtered.length} more entries truncated)` : ""}` }] };
  }

  async outline({ file, dir }) {
    const root = resolveDir(dir);
    const abs = path.isAbsolute(file) ? file : path.join(root, file);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) throw new Error(`File not found: ${abs}`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File too large (${stat.size} bytes)`);
    const ext = path.extname(abs);
    const content = await fs.readFile(abs, "utf8");
    const totalLines = content.split("\n").length;
    if (!CODE_EXT.has(ext)) {
      return { content: [{ type: "text", text: `${abs}\n${totalLines} lines, ext ${ext || "(none)"} — no symbol extractor for this type. First 20 lines:\n` + content.split("\n").slice(0, 20).join("\n") }] };
    }
    const syms = extractSymbols(content, ext);
    const list = syms.length ? syms.map((s) => `  L${s.line}: ${s.name}`).join("\n") : "  (no top-level symbols detected)";
    return { content: [{ type: "text", text: `Outline of ${abs}\n${totalLines} lines, ${syms.length} symbols:\n${list}` }] };
  }

  async search({ query, dir, limit = 50 }) {
    const root = resolveDir(dir);
    const q = String(query).toLowerCase();
    const all = await walk(root, "", [], 0, 10);
    const hits = all.filter((f) => !f.dir && f.rel.toLowerCase().includes(q)).map((f) => f.rel).slice(0, Math.max(1, Math.min(500, limit)));
    return { content: [{ type: "text", text: hits.length ? `Matches for "${query}" (${hits.length}):\n` + hits.map((h) => `  ${h}`).join("\n") : `No path matches for "${query}" in ${root}` }] };
  }

  async run() {
    const t = new StdioServerTransport();
    await this.server.connect(t);
    console.error("Context Pack MCP server running on stdio");
  }
}

new ContextPackServer().run().catch(console.error);
