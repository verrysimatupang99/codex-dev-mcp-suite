#!/usr/bin/env node

/**
 * Context Pack MCP Server for Codex
 *
 * Builds a compact, token-budgeted "briefing" of a project so a fresh
 * session can get oriented without re-pasting files or blowing the context
 * window. Detects stack, shows a pruned tree, surfaces key files, and
 * extracts top-level symbols (functions/classes/exports) heuristically.
 *
 * Tools: pack_overview, pack_tree, pack_outline, pack_search, pack_audit
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

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
const AUDIT_SENSITIVE_PATTERNS = [
  /^\.env/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i,
  /id_rsa/i, /id_ed25519/i, /id_ecdsa/i, /id_dsa/i,
  /known_hosts/i, /authorized_keys/i,
  /credentials/i, /password/i, /secret/i, /token/i,
  /\.htpasswd/i, /\.netrc/i, /npmrc$/i,
  /service[_-]?account.*\.json$/i,
];
const AUDIT_SECRET_CONTENT_RE = [
  /sk-[a-zA-Z0-9]{20,}/i,
  /ghp_[a-zA-Z0-9]{36}/i,
  /gho_[a-zA-Z0-9]{36}/i,
  /glpat-[a-zA-Z0-9\-_]{20}/i,
  /AKIA[0-9A-Z]{16}/i,
  /AIza[0-9A-Za-z_-]{35}/i,
  /bearer\s+[a-zA-Z0-9_\-\.]{20,}/i,
  /api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9_\-]{16,}/i,
  /password\s*[:=]\s*["']?[^\s"']{6,}/i,
];
const AUDIT_LARGE_WARN = 100_000;
const AUDIT_LARGE_CRIT = 1_000_000;
const AUDIT_MAX_SCAN = 16_384;

function isSensitiveName(filename) {
  return AUDIT_SENSITIVE_PATTERNS.some((pattern) => pattern.test(filename));
}

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
        {
          name: "pack_audit",
          description: "Audit project for security risks, leaked secrets/credentials, missing .gitignore, uncommitted sensitive files, and overly large files.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              strict: { type: "boolean", description: "Flag missing .gitignore as critical instead of warn", default: false },
            },
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
          case "pack_audit": return await this.audit(args || {});
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

  

  async audit({ dir, strict = false }) {
    const root = resolveDir(dir);
    const findings = [];

    function add(sev, msg, fix) {
      findings.push({ severity: sev, message: msg, fix });
    }

    // walk
    let all = [];
    try { all = await walk(root, "", [], 0, 6); } catch { /* ignore */ }
    const files = all.filter((f) => !f.dir);

    // git presence and status
    let gitRoot = null;
    try {
      const g = execSync("git rev-parse --show-toplevel", { cwd: root, encoding: "utf8", timeout: 3000 }).trim();
      gitRoot = g;
    } catch { /* not a git repo */ }

    let gitStatus = [];
    if (gitRoot) {
      try {
        const out = execSync("git status --porcelain", { cwd: root, encoding: "utf8", timeout: 5000 });
        gitStatus = out.trim().split("\n").filter(Boolean).map((line) => {
          const code = line.slice(0, 2);
          const file = line.slice(3);
          return { code, file, untracked: code === "??" };
        });
      } catch { /* ignore */ }
    }

    const statusMap = new Map(gitStatus.map((s) => [s.file, s]));

    // Helpers
    const isGitTracked = (rel) => {
      const s = statusMap.get(rel);
      if (!s) return true; // assume tracked if no status (could be clean tracked)
      return !s.untracked;
    };
    const isIgnored = (rel) => {
      try {
        execSync(`git check-ignore -q -- "${rel}"`, { cwd: root, timeout: 2000 });
        return true;
      } catch { return false; }
    };

    // --- Missing critical files ---
    const hasGitignore = files.some((f) => f.rel === ".gitignore" || path.basename(f.rel) === ".gitignore");
    const hasEnvExample = files.some((f) => f.rel === ".env.example" || f.rel === ".env.sample" || f.rel === ".env.template");
    if (gitRoot && !hasGitignore) add(strict ? "critical" : "warn", "No .gitignore found in a git repository.", "Add a .gitignore to prevent accidental commits of build artifacts, secrets, and OS files.");
    if (!hasEnvExample) add("info", "No .env.example / .env.sample found.", "Add .env.example with dummy values so contributors know which env vars are required.");

    // --- File-by-file scan ---
    for (const f of files) {
      const basename = path.basename(f.rel);
      const abs = path.join(root, f.rel);
      let stat;
      try { stat = await fs.stat(abs); } catch { continue; }
      const size = stat.size;
      const sensitiveName = isSensitiveName(basename);

      // large files
      if (size > AUDIT_LARGE_CRIT) {
        add("critical", `Large file: ${f.rel} (${(size/1e6).toFixed(1)} MB)`, "Consider adding to .gitignore, using Git LFS, or splitting.");
      } else if (size > AUDIT_LARGE_WARN) {
        add("warn", `Large file: ${f.rel} (${(size/1e3).toFixed(0)} KB)`, "Consider adding to .gitignore, using Git LFS, or splitting.");
      }

      // exposed sensitive files
      if (sensitiveName) {
        if (gitRoot) {
          const tracked = isGitTracked(f.rel);
          const ignored = isIgnored(f.rel);
          if (tracked && !ignored) {
            add("critical", `Sensitive file committed to git: ${f.rel}`, "Remove from git history (e.g. git-filter-repo), add to .gitignore, rotate any exposed secrets.");
          } else if (!tracked) {
            add("warn", `Sensitive file untracked: ${f.rel}`, "Ensure it is listed in .gitignore and never committed.");
          } else if (ignored) {
            add("info", `Sensitive file present but gitignored: ${f.rel}`, "OK — ensure secrets are rotated if previously committed.");
          }
        } else {
          add("warn", `Sensitive file found (not a git repo): ${f.rel}`, "Review permissions and consider encrypting or moving to a secret manager.");
        }
      }

      // secret content scan (small text-ish files only)
      if (!f.dir && (CODE_EXT.has(path.extname(basename)) || [".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env", ".sh"].includes(path.extname(basename).toLowerCase()) || basename.startsWith(".env"))) {
        if (size > 0 && size < AUDIT_MAX_SCAN * 4) {
          let content = "";
          try {
            const fd = await fs.open(abs, "r");
            const buf = Buffer.alloc(Math.min(size, AUDIT_MAX_SCAN));
            await fd.read(buf, 0, buf.length, 0);
            await fd.close();
            content = buf.toString("utf8");
          } catch { continue; }
          for (const re of AUDIT_SECRET_CONTENT_RE) {
            if (re.test(content)) {
              add("critical", `Possible secret/hardcoded credential in ${f.rel}`, "Move to environment vars, secret manager, or encrypted vault. Rotate leaked value immediately.");
              break;
            }
          }
        }
      }
    }

    // --- duplicate / inconsistent configs ---
    const envFiles = files.filter((f) => path.basename(f.rel).startsWith(".env"));
    if (envFiles.length > 2) {
      add("info", `Multiple env files found (${envFiles.map((f) => f.rel).join(", ")})`, "Consolidate variants into .env, .env.local, .env.production. Ensure .gitignore covers all .env* except .env.example.");
    }

    // --- render ---
    const icon = { critical: "🔴", warn: "🟡", info: "🟢" };
    const groups = { critical: [], warn: [], info: [] };
    for (const f of findings) groups[f.severity].push(f);
    const lines = [`# Audit: ${path.basename(root)}`, `Path: ${root}`, `Git repo: ${gitRoot ? gitRoot : "no"}`, ``];
    for (const sev of ["critical", "warn", "info"]) {
      if (!groups[sev].length) continue;
      lines.push(`## ${icon[sev]} ${sev.toUpperCase()} (${groups[sev].length})`);
      for (const f of groups[sev]) {
        lines.push(`- ${f.message}`);
        if (f.fix) lines.push(`  → Fix: ${f.fix}`);
      }
      lines.push("");
    }
    if (!findings.length) lines.push("🟢 No issues detected.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  async run() {
    const t = new StdioServerTransport();
    await this.server.connect(t);
    console.error("Context Pack MCP server running on stdio");
  }
}

new ContextPackServer().run().catch(console.error);
