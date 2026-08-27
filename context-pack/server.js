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
          name: "pack_find_todos",
          description: "Scan the codebase for TODO, FIXME, HACK, and NOTE comments to surface technical debt.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" }
            }
          }
        },
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
        {
          name: "pack_impact",
          description: "Analyze dependency blast-radius and callers for a specific file to prevent breaking downstream code.",
          inputSchema: {
            type: "object",
            properties: {
              targetFile: { type: "string", description: "Relative path to target file (e.g. 'lib/stats.js')" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              maxDepth: { type: "number", description: "Traversal depth", default: 3 },
            },
            required: ["targetFile"],
          },
        },
        {
          name: "pack_guard",
          description: "Execute self-healing diagnostic pre-flight checks (typecheck, lint, test) and return structured findings.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              checkType: { type: "string", description: "Check type: 'all' | 'typecheck' | 'test' | 'lint'", default: "all" },
            },
          },
        },
        {
          name: "pack_telemetry",
          description: "Read live dev server logs, runtime errors, and stack traces to diagnose issues without asking user to copy-paste logs.",
          inputSchema: {
            type: "object",
            properties: {
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
              logFile: { type: "string", description: "Path to specific log file (optional)" },
              limit: { type: "number", description: "Max log entries", default: 50 },
            },
          },
        },
        {
          name: "pack_predictive_diff",
          description: "Simulate proposed file changes against caller files to predict breaking contract or API signature changes.",
          inputSchema: {
            type: "object",
            properties: {
              targetFile: { type: "string", description: "Target file path" },
              proposedDiff: { type: "string", description: "Proposed code snippet or diff" },
              dir: { type: "string", description: "Project directory (defaults to CWD)" },
            },
            required: ["targetFile", "proposedDiff"],
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
          case "pack_find_todos": return await this.findTodos(args || {});
          case "pack_audit": return await this.audit(args || {});
          case "pack_impact": return await this.impact(args || {});
          case "pack_guard": return await this.guard(args || {});
          case "pack_telemetry": return await this.telemetry(args || {});
          case "pack_predictive_diff": return await this.predictiveDiff(args || {});
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

  async search({ query, dir, limit = 50, include_content = false }) {
    const root = resolveDir(dir);
    const q = String(query).toLowerCase();
    const all = await walk(root, "", [], 0, 10);
    const max = Math.max(1, Math.min(500, limit));
    
    if (!include_content) {
      const hits = all.filter((f) => !f.dir && f.rel.toLowerCase().includes(q)).map((f) => f.rel).slice(0, max);
      return { content: [{ type: "text", text: hits.length ? `Matches for "${query}" (${hits.length}):\n` + hits.map((h) => `  ${h}`).join("\n") : `No path matches for "${query}" in ${root}` }] };
    } else {
      const hits = [];
      for (const f of all) {
        if (f.dir) continue;
        if (hits.length >= max) break;
        try {
          const stat = await fs.stat(path.join(root, f.rel));
          if (stat.size > MAX_FILE_BYTES) continue;
          const content = await fs.readFile(path.join(root, f.rel), "utf8");
          if (content.toLowerCase().includes(q)) {
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
               if (lines[i].toLowerCase().includes(q)) {
                  hits.push(`${f.rel}:${i+1} -> ${lines[i].trim().slice(0, 120)}`);
                  if (hits.length >= max) break;
               }
            }
          }
        } catch { /* ignore */ }
      }
      return { content: [{ type: "text", text: hits.length ? `Content matches for "${query}" (${hits.length}):\n` + hits.map((h) => `  ${h}`).join("\n") : `No content matches for "${query}" in ${root}` }] };
    }
  }

  async findTodos({ dir }) {
    const root = resolveDir(dir);
    const all = await walk(root, "", [], 0, 10);
    const files = all.filter(f => !f.dir && CODE_EXT.has(path.extname(f.rel)));
    const findings = [];
    const todoRe = /(TODO|FIXME|HACK|NOTE)[\s:]+(.*)/i;
    
    for (const f of files) {
      try {
        const stat = await fs.stat(path.join(root, f.rel));
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = await fs.readFile(path.join(root, f.rel), "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(todoRe);
          if (m) {
            findings.push(`${f.rel}:${i+1} [${m[1].toUpperCase()}] ${m[2].trim()}`);
          }
        }
      } catch { /* ignore */ }
    }
    
    if (findings.length === 0) return { content: [{ type: "text", text: `No TODO/FIXME/HACK found in ${root}` }] };
    return { content: [{ type: "text", text: `Found ${findings.length} technical debt items:\n\n` + findings.slice(0, 500).join("\n") }] };
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

  async impact({ targetFile, dir, maxDepth = 3 }) {
    const root = resolveDir(dir);
    if (!targetFile) throw new Error("targetFile is required");
    const normTarget = targetFile.replace(/\\/g, "/").replace(/^\.\//, "");
    const all = await walk(root, "", [], 0, 8);
    const codeFiles = all.filter((f) => !f.dir && CODE_EXT.has(path.extname(f.rel)));

    const importMap = new Map();
    const reverseMap = new Map();

    for (const f of codeFiles) {
      const abs = path.join(root, f.rel);
      try {
        const content = await fs.readFile(abs, "utf8");
        const imports = [];
        const re = /(?:import|export)\s+.*?\s+from\s+["']([^"']+)["']|require\(["']([^"']+)["']\)|import\(["']([^"']+)["']\)/g;
        let match;
        while ((match = re.exec(content)) !== null) {
          const spec = match[1] || match[2] || match[3];
          if (spec && (spec.startsWith(".") || spec.startsWith("/"))) {
            const dirName = path.dirname(f.rel);
            const resolvedRel = path.normalize(path.join(dirName, spec)).replace(/\\/g, "/");
            imports.push(resolvedRel);
          }
        }
        importMap.set(f.rel.replace(/\\/g, "/"), imports);
      } catch {}
    }

    for (const [importer, importedList] of importMap.entries()) {
      for (const imp of importedList) {
        for (const f of codeFiles) {
          const fRel = f.rel.replace(/\\/g, "/");
          const fRelNoExt = fRel.replace(/\.[^/.]+$/, "");
          if (fRel === imp || fRelNoExt === imp || fRelNoExt === imp.replace(/\/index$/, "")) {
            if (!reverseMap.has(fRel)) reverseMap.set(fRel, []);
            reverseMap.get(fRel).push(importer);
          }
        }
      }
    }

    const directImporters = reverseMap.get(normTarget) || [];
    const directImports = importMap.get(normTarget) || [];

    const lines = [
      `# Impact Blast-Radius: ${normTarget}`,
      `Project: ${root}`,
      ``,
      `## 🎯 Direct Importers / Callers (${directImporters.length})`,
      ...(directImporters.length ? directImporters.map((f) => `- \`${f}\``) : ["- None (No other file directly imports this file)"]),
      ``,
      `## 📦 Outbound Imports (${directImports.length})`,
      ...(directImports.length ? directImports.map((f) => `- \`${f}\``) : ["- None"]),
      ``,
      `## ⚠️ Calculated Blast-Radius Score: ${directImporters.length > 5 ? "HIGH 🔴" : directImporters.length > 2 ? "MEDIUM 🟡" : "LOW 🟢"}`
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  async guard({ dir, checkType = "all" }) {
    const root = resolveDir(dir);
    const pkgPath = path.join(root, "package.json");
    let hasPkg = false;
    let pkg = {};
    try {
      pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
      hasPkg = true;
    } catch {}

    const runScript = (cmd, label) => {
      try {
        const out = execSync(cmd, { cwd: root, encoding: "utf8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] });
        return { label, status: "PASS 🟢", output: out.slice(0, 500) };
      } catch (e) {
        const errOut = (e.stdout || "") + "\n" + (e.stderr || "");
        return { label, status: "FAIL 🔴", output: errOut.slice(0, 1000) };
      }
    };

    const results = [];
    if (hasPkg && pkg.scripts) {
      if ((checkType === "all" || checkType === "typecheck") && (pkg.scripts.typecheck || pkg.scripts["check-types"])) {
        results.push(runScript("npm run " + (pkg.scripts.typecheck ? "typecheck" : "check-types"), "Typecheck"));
      } else if (hasPkg && await fs.access(path.join(root, "tsconfig.json")).then(() => true).catch(() => false)) {
        results.push(runScript("npx tsc --noEmit", "Typecheck (tsc)"));
      }

      if ((checkType === "all" || checkType === "lint") && pkg.scripts.lint) {
        results.push(runScript("npm run lint", "Linter"));
      }

      if ((checkType === "all" || checkType === "test") && pkg.scripts.test) {
        results.push(runScript("npm test", "Test Suite"));
      }
    }

    const lines = [`# Guard Pre-flight Diagnostics: ${path.basename(root)}`, `Path: ${root}`, ``];
    if (!results.length) {
      lines.push("ℹ️ No build/test/lint scripts detected in project toolchain.");
    } else {
      for (const r of results) {
        lines.push(`## ${r.label}: ${r.status}`);
        if (r.output) {
          lines.push("```");
          lines.push(r.output.trim());
          lines.push("```");
        }
        lines.push("");
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  async telemetry({ dir, logFile, limit = 50 }) {
    const root = resolveDir(dir);
    const candidateFiles = [];
    if (logFile) candidateFiles.push(path.resolve(root, logFile));
    candidateFiles.push(
      path.join(root, "error.log"),
      path.join(root, "app.log"),
      path.join(root, "dev.log"),
      path.join(root, "server.log"),
      path.join(root, ".next", "server.log"),
      "/tmp/dev.log"
    );

    let foundPath = null;
    let content = "";
    for (const f of candidateFiles) {
      try {
        content = await fs.readFile(f, "utf8");
        foundPath = f;
        break;
      } catch {}
    }

    const lines = [`# Live Runtime Telemetry Observer: ${path.basename(root)}`, `Observed Log File: ${foundPath ? foundPath : "None detected (create dev.log or error.log in project)"}`, ``];
    if (foundPath && content) {
      const rawLines = content.split("\n").filter((l) => l.trim().length > 0);
      const recent = rawLines.slice(-limit);
      const errors = recent.filter((l) => /error|exception|fail|crash|500|unhandled/i.test(l));
      lines.push(`## 🔴 Surfaced Errors / Exceptions (${errors.length})`);
      if (errors.length) {
        lines.push("```");
        lines.push(errors.join("\n"));
        lines.push("```");
      } else {
        lines.push("🟢 No runtime errors detected in recent log lines.");
      }

      lines.push(``);
      lines.push(`## 📜 Recent Log Feed (${recent.length} lines)`);
      lines.push("```");
      lines.push(recent.slice(-20).join("\n"));
      lines.push("```");
    } else {
      lines.push("ℹ️ No active dev server log file found. Pass logFile parameter or log output to `./error.log` or `/tmp/dev.log`.");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  async predictiveDiff({ targetFile, proposedDiff, dir }) {
    const root = resolveDir(dir);
    const impactRes = await this.impact({ targetFile, dir, maxDepth: 3 });
    const impactText = impactRes.content[0].text;

    const warnings = [];
    if (/delete|remove|drop|rename/i.test(proposedDiff)) {
      warnings.push("⚠️ Proposed diff contains potential destructive operation (delete/drop/rename).");
    }
    if (/export\s+(const|function|class|interface|type)\s+/i.test(proposedDiff)) {
      warnings.push("ℹ️ Exported symbol signature changed. Verify caller arguments in dependent files.");
    }

    const lines = [
      `# Predictive Contract & Diff Analysis: ${targetFile}`,
      `Project: ${root}`,
      ``,
      `## 🔮 Predicted Impact Warnings (${warnings.length})`,
      ...(warnings.length ? warnings.map((w) => `- ${w}`) : ["🟢 No high-risk signature breaks predicted."]),
      ``,
      impactText
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  async run() {
    const t = new StdioServerTransport();
    await this.server.connect(t);
    console.error("Context Pack MCP server running on stdio");
  }
}

new ContextPackServer().run().catch(console.error);
