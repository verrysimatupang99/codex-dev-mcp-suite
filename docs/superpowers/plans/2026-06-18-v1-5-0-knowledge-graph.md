# v1.5.0 Knowledge Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add note linking, cross-project recall, and safe duplicate detection to `project-memory` without making embeddings mandatory and without breaking existing vaults.

**Architecture:** Extend `project-memory` with a small graph/index layer rather than a separate subsystem. Keep canonical note content in Markdown and per-project `index.json`, derive link/global lookup state from existing notes, and expose three new MCP tools that degrade cleanly to keyword/deterministic behavior.

**Tech Stack:** Node.js 18+, ESM, `@modelcontextprotocol/sdk`, local JSON indexes, existing embedding/rerank helpers, existing `project-memory/test.mjs` harness.

## Global Constraints

- Keep release scope limited to `memory_link`, `memory_global_recall`, and `memory_dedup`.
- Do not auto-merge or auto-delete notes.
- Keep embeddings optional; keyword/deterministic fallback must remain usable.
- Preserve same-project bias for resolution and ranking.
- Derived graph state must be rebuildable from canonical note content and metadata.
- Existing vaults must continue to work without a mandatory blocking migration.
- Keep MCP tool surface separate rather than creating one monolithic graph tool.

---

## File Structure

### Existing files to modify

- Modify: `project-memory/server.js`
  - Register three new MCP tools.
  - Route tool calls to new graph helper methods.
  - Reuse existing path/index/note-loading patterns.
- Modify: `project-memory/test.mjs`
  - Add end-to-end MCP tests for link resolution, global recall, dedup, and lazy backfill.
- Modify: `README.md`
  - Document the three new tools and the link syntax.
- Modify: `CHANGELOG.md`
  - Add `v1.5.0` entry.
- Modify: `package.json`
  - Bump version to `1.5.0` once implementation is complete.

### New files to create

- Create: `project-memory/graph.js`
  - Parse wiki-style links from note bodies.
  - Resolve links by same-project bias, explicit project override, and global fallback.
  - Build backlink maps and graph-derived metadata.
- Create: `project-memory/global-index.js`
  - Enumerate projects in the vault.
  - Load per-project note metadata into a global candidate set.
  - Provide shared helpers for cross-project recall and dedup.
- Create: `project-memory/dedup.js`
  - Compute duplicate-candidate scores using title/content/link/semantic signals.
  - Produce non-destructive review output.

### Unit boundaries

- `server.js` stays as the MCP boundary and orchestration layer.
- `graph.js` owns link parsing, graph state derivation, and backlink logic.
- `global-index.js` owns cross-project enumeration and candidate gathering.
- `dedup.js` owns duplicate scoring only.
- Tests remain end-to-end in `project-memory/test.mjs` to match current repo style.

### Task 1: Build Graph Parsing and Derived State Helpers

**Files:**
- Create: `project-memory/graph.js`
- Modify: `project-memory/server.js`
- Test: `project-memory/test.mjs`

**Interfaces:**
- Consumes: `projectSlug(dir)`, `parseFrontmatter(raw)`, `loadIndex(p)`, `saveIndex(p, index)` patterns from `project-memory/server.js`
- Produces:
  - `extractWikiLinks(body: string): Array<{ raw: string, ref: string, project: string|null, kind: "id"|"title" }>`
  - `loadNoteBody(projectDir: string, file: string): Promise<string>`
  - `ensureGraphState(args: { vaultRoot: string, projectDir: string, slug: string, index: object, noteLoader: Function }): Promise<{ index: object, changed: boolean }>`
  - `resolveLink(args: { vaultRoot: string, currentSlug: string, ref: string, project: string|null, kind: "id"|"title" }): Promise<{ status: "resolved"|"ambiguous"|"missing", match?: object, candidates?: object[] }>`

- [ ] **Step 1: Write the failing graph helper tests**

```js
it("parses wiki links from note bodies", async () => {
  const mod = await import("./graph.js");
  const links = mod.extractWikiLinks("See [[abc123]] and [[proj:Design Note]] and [[JWT Flow]]");
  assertEqual(links, [
    { raw: "[[abc123]]", ref: "abc123", project: null, kind: "id" },
    { raw: "[[proj:Design Note]]", ref: "Design Note", project: "proj", kind: "title" },
    { raw: "[[JWT Flow]]", ref: "JWT Flow", project: null, kind: "title" },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node project-memory/test.mjs`
Expected: FAIL with missing `./graph.js` import or missing `extractWikiLinks`

- [ ] **Step 3: Write minimal graph helper implementation**

```js
// project-memory/graph.js
export function extractWikiLinks(body) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(String(body || "")))) {
    const raw = m[0];
    const inner = m[1].trim();
    const colon = inner.indexOf(":");
    const project = colon > 0 ? inner.slice(0, colon).trim() : null;
    const ref = colon > 0 ? inner.slice(colon + 1).trim() : inner;
    const kind = /^[0-9T-]{10,}/.test(ref) ? "id" : "title";
    out.push({ raw, ref, project, kind });
  }
  return out;
}
```

- [ ] **Step 4: Extend helper to derive per-note graph metadata**

```js
export async function ensureGraphState({ index, projectDir, noteLoader }) {
  let changed = false;
  const backlinks = new Map();
  for (const note of Object.values(index.notes || {})) {
    const body = await noteLoader(projectDir, note.file);
    const links = extractWikiLinks(body).map((x) => ({
      raw: x.raw,
      ref: x.ref,
      project: x.project,
      kind: x.kind,
    }));
    const next = JSON.stringify(links);
    const prev = JSON.stringify(note.links || []);
    if (next !== prev) {
      note.links = links;
      changed = true;
    }
  }
  for (const note of Object.values(index.notes || {})) {
    for (const link of note.links || []) {
      if (link.project) continue;
      if (link.kind !== "id") continue;
      const arr = backlinks.get(link.ref) || [];
      arr.push({ id: note.id, title: note.title });
      backlinks.set(link.ref, arr);
    }
  }
  for (const note of Object.values(index.notes || {})) {
    const next = backlinks.get(note.id) || [];
    if (JSON.stringify(next) !== JSON.stringify(note.backlinks || [])) {
      note.backlinks = next;
      changed = true;
    }
  }
  return { index, changed };
}
```

- [ ] **Step 5: Run targeted tests to verify helper passes**

Run: `node project-memory/test.mjs`
Expected: PASS for new graph helper tests; other unrelated tests still passing

### Task 2: Add `memory_link` MCP Tool

**Files:**
- Modify: `project-memory/server.js`
- Modify: `project-memory/test.mjs`
- Consumes: `extractWikiLinks`, `ensureGraphState`, `resolveLink` from `project-memory/graph.js`
- Produces:
  - MCP tool `memory_link`
  - Handler signature: `memory_link({ id?: string, dir?: string, include_unresolved?: boolean }): Promise<ToolResult>`

**Interfaces:**
- Consumes: `paths(dir)`, `loadIndex(p)`, `saveIndex(p, index)`
- Produces: `async link(args)` method on `ProjectMemoryServer`

- [ ] **Step 1: Write the failing MCP test for `memory_link`**

```js
it("memory_link resolves note links and backlinks", async () => {
  const saveA = await client.callTool("memory_save", {
    dir: DEMO,
    title: "Auth Hub",
    content: "See [[JWT Details]]",
    tags: ["auth"],
  });
  const saveB = await client.callTool("memory_save", {
    dir: DEMO,
    title: "JWT Details",
    content: "Token notes",
    tags: ["jwt"],
  });
  const idA = (saveA.text.match(/Saved note (\S+)/) || [])[1];
  const r = await client.callTool("memory_link", { dir: DEMO, id: idA });
  assertIncludes(r.text, "Auth Hub");
  assertIncludes(r.text, "JWT Details");
  assertIncludes(r.text, "resolved");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node project-memory/test.mjs`
Expected: FAIL with `Unknown tool: memory_link`

- [ ] **Step 3: Register the new tool in `ListToolsRequestSchema`**

```js
{
  name: "memory_link",
  description: "Resolve wiki-style note links and show backlinks for a note.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Note id to inspect" },
      dir: { type: "string", description: "Project directory (defaults to CWD)" },
      include_unresolved: { type: "boolean", default: true }
    },
    required: ["id"]
  }
}
```

- [ ] **Step 4: Add call routing and minimal handler**

```js
case "memory_link": return await this.link(args || {});

async link({ id, dir, include_unresolved = true }) {
  id = limit(id, "id", 100);
  const p = this.paths(dir);
  const index = await this.loadIndex(p);
  const note = index.notes?.[id];
  if (!note) throw new Error(`Note ${id} not found in ${p.slug}`);
  const { ensureGraphState, resolveLink, loadNoteBody } = await import("./graph.js");
  const ensured = await ensureGraphState({
    vaultRoot: VAULT_ROOT,
    projectDir: p.projectDir,
    slug: p.slug,
    index,
    noteLoader: loadNoteBody,
  });
  if (ensured.changed) await this.saveIndex(p, ensured.index);
  const links = [];
  for (const link of ensured.index.notes[id].links || []) {
    const resolved = await resolveLink({
      vaultRoot: VAULT_ROOT,
      currentSlug: p.slug,
      ref: link.ref,
      project: link.project,
      kind: link.kind,
    });
    if (resolved.status !== "missing" || include_unresolved) links.push({ link, resolved });
  }
  return { content: [{ type: "text", text: JSON.stringify({ note: ensured.index.notes[id], links }, null, 2) }] };
}
```

- [ ] **Step 5: Improve output formatting for human-readable backlinks**

```js
const lines = [
  `Links for ${note.title} (${note.id})`,
  "",
  "Outgoing:",
  ...links.map(({ link, resolved }) => `- ${link.raw} -> ${resolved.status}${resolved.match ? ` (${resolved.match.title})` : ""}`),
  "",
  "Backlinks:",
  ...(note.backlinks || []).map((b) => `- ${b.title} (${b.id})`),
];
return { content: [{ type: "text", text: lines.join("\n") }] };
```

- [ ] **Step 6: Run targeted tests to verify `memory_link` passes**

Run: `node project-memory/test.mjs`
Expected: PASS for `memory_link` tests and no regressions in existing `memory_save` / `memory_recall`

### Task 3: Build Global Project Enumeration Helpers

**Files:**
- Create: `project-memory/global-index.js`
- Modify: `project-memory/test.mjs`

**Interfaces:**
- Consumes: `VAULT_ROOT` directory layout and per-project `index.json`
- Produces:
  - `listProjects(vaultRoot: string): Promise<Array<{ slug: string, projectDir: string, indexFile: string }>>`
  - `loadGlobalNotes(vaultRoot: string): Promise<Array<{ slug: string, note: object }>>`
  - `findGlobalCandidates(args: { vaultRoot: string, currentSlug: string, query: string }): Promise<Array<{ slug: string, note: object }>>`

- [ ] **Step 1: Write the failing global-index test**

```js
it("loads notes across projects for global operations", async () => {
  const mod = await import("./global-index.js");
  const rows = await mod.loadGlobalNotes(process.env.MEMORY_VAULT_DIR);
  assert(rows.length >= 1, "expected at least one global note row");
  assert("slug" in rows[0]);
  assert("note" in rows[0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node project-memory/test.mjs`
Expected: FAIL with missing `./global-index.js`

- [ ] **Step 3: Write minimal global-index implementation**

```js
// project-memory/global-index.js
import fs from "fs/promises";
import path from "path";

export async function listProjects(vaultRoot) {
  let slugs = [];
  try { slugs = await fs.readdir(vaultRoot); } catch { slugs = []; }
  return slugs.map((slug) => ({
    slug,
    projectDir: path.join(vaultRoot, slug),
    indexFile: path.join(vaultRoot, slug, "index.json"),
  }));
}

export async function loadGlobalNotes(vaultRoot) {
  const projects = await listProjects(vaultRoot);
  const rows = [];
  for (const p of projects) {
    try {
      const raw = await fs.readFile(p.indexFile, "utf8");
      const index = JSON.parse(raw);
      for (const note of Object.values(index.notes || {})) rows.push({ slug: p.slug, note });
    } catch {}
  }
  return rows;
}
```

- [ ] **Step 4: Add same-project-first candidate ordering helper**

```js
export async function findGlobalCandidates({ vaultRoot, currentSlug, query }) {
  const q = String(query || "").toLowerCase();
  const rows = await loadGlobalNotes(vaultRoot);
  return rows
    .filter(({ note }) => note.title?.toLowerCase().includes(q) || (note.keywords || []).some((k) => k.includes(q)))
    .sort((a, b) => {
      const ap = a.slug === currentSlug ? 0 : 1;
      const bp = b.slug === currentSlug ? 0 : 1;
      return ap - bp || (a.note.created < b.note.created ? 1 : -1);
    });
}
```

- [ ] **Step 5: Run targeted tests to verify helpers pass**

Run: `node project-memory/test.mjs`
Expected: PASS for global helper tests

### Task 4: Add `memory_global_recall` MCP Tool

**Files:**
- Modify: `project-memory/server.js`
- Modify: `project-memory/test.mjs`
- Consumes: `loadGlobalNotes`, `findGlobalCandidates` from `project-memory/global-index.js`; `embedOne`, `cosine`, `rerank`, `rerankConfig`
- Produces:
  - MCP tool `memory_global_recall`
  - Handler signature: `memory_global_recall({ query, dir?, limit?, full? }): Promise<ToolResult>`

**Interfaces:**
- Consumes: existing keyword/semantic scoring logic from `recall()`
- Produces: `async globalRecall(args)` method on `ProjectMemoryServer`

- [ ] **Step 1: Write the failing MCP test for same-project bias**

```js
it("memory_global_recall prefers same-project notes before global fallback", async () => {
  await client.callTool("memory_save", { dir: DEMO, title: "API Auth Local", content: "same project winner" });
  await client.callTool("memory_save", { dir: "/tmp/pm-other-project", title: "API Auth Remote", content: "other project candidate" });
  const r = await client.callTool("memory_global_recall", { dir: DEMO, query: "API Auth", limit: 5 });
  const localPos = r.text.indexOf("API Auth Local");
  const remotePos = r.text.indexOf("API Auth Remote");
  assert(localPos !== -1 && remotePos !== -1);
  assert(localPos < remotePos, "expected same-project note first");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node project-memory/test.mjs`
Expected: FAIL with `Unknown tool: memory_global_recall`

- [ ] **Step 3: Register the new tool and route calls**

```js
{
  name: "memory_global_recall",
  description: "Recall relevant notes across projects with same-project bias and graceful keyword fallback.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      dir: { type: "string" },
      limit: { type: "number", default: 5 },
      full: { type: "boolean", default: false }
    },
    required: ["query"]
  }
}

case "memory_global_recall": return await this.globalRecall(args || {});
```

- [ ] **Step 4: Implement minimal global recall reusing current ranking style**

```js
async globalRecall({ query, dir, limit: lim = 5, full = false }) {
  query = limit(query, "query", 2000);
  const p = this.paths(dir);
  const { loadGlobalNotes } = await import("./global-index.js");
  const rows = await loadGlobalNotes(VAULT_ROOT);
  const qTokens = new Set(tokenize(query));
  const qVec = deterministicEnabled() ? null : await embedOne(query);
  const scored = rows.map(({ slug, note }) => {
    let kwScore = 0;
    for (const k of note.keywords || []) if (qTokens.has(k)) kwScore += 1;
    for (const w of tokenize(note.title)) if (qTokens.has(w)) kwScore += 2;
    const sameProjectBoost = slug === p.slug ? 0.25 : 0;
    const sim = qVec && Array.isArray(note.embedding) ? cosine(qVec, note.embedding) : 0;
    const score = (sim ? 0.8 * sim : 0) + (0.2 * kwScore) + sameProjectBoost;
    return { slug, note, sim, score };
  }).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.note.created < b.note.created ? 1 : -1))
    .slice(0, Math.max(1, Math.min(20, lim)));
  return { content: [{ type: "text", text: scored.map((x) => `- [${x.slug}] ${x.note.title}`).join("\n") }] };
}
```

- [ ] **Step 5: Add provenance labels and keyword fallback path**

```js
const mode = qVec && rows.some((x) => Array.isArray(x.note.embedding)) ? "semantic+graph" : "keyword+graph";
const blocks = await Promise.all(scored.map(async ({ slug, note, sim, score }) => {
  const raw = await fs.readFile(path.join(VAULT_ROOT, slug, note.file), "utf8").catch(() => "");
  const { body } = parseFrontmatter(raw);
  const text = full ? body.trim() : body.trim().split("\n").slice(0, 12).join("\n");
  return `### ${note.title}  ([${slug}], ${sim ? `sim:${sim.toFixed(3)}` : `score:${score.toFixed(2)}`})\n${text}`;
}));
return { content: [{ type: "text", text: `Global recall for "${query}" [${mode}]:\n\n${blocks.join("\n\n---\n\n")}` }] };
```

- [ ] **Step 6: Run targeted tests to verify same-project bias and fallback behavior**

Run: `node project-memory/test.mjs`
Expected: PASS for global recall tests; same-project result ordered before remote candidates

### Task 5: Build Duplicate Scoring Helpers

**Files:**
- Create: `project-memory/dedup.js`
- Modify: `project-memory/test.mjs`

**Interfaces:**
- Consumes: `tokenize`-compatible keyword data, note bodies, optional embeddings
- Produces:
  - `scoreDuplicatePair(args: { a: object, b: object, aBody: string, bBody: string }): { score: number, reasons: string[] }`
  - `findDuplicateCandidates(args: { rows: Array<{ slug: string, note: object, body: string }>, threshold: number }): Array<{ left: object, right: object, score: number, reasons: string[] }>`

- [ ] **Step 1: Write the failing duplicate-score test**

```js
it("scores duplicate candidates with explanatory reasons", async () => {
  const mod = await import("./dedup.js");
  const result = mod.scoreDuplicatePair({
    a: { title: "JWT Plan", links: [] },
    b: { title: "JWT Plan", links: [] },
    aBody: "refresh token cookie flow",
    bBody: "refresh token cookie flow",
  });
  assert(result.score >= 0.9);
  assert(result.reasons.some((x) => x.includes("title")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node project-memory/test.mjs`
Expected: FAIL with missing `./dedup.js`

- [ ] **Step 3: Write minimal duplicate-score implementation**

```js
// project-memory/dedup.js
function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size || 1;
  return inter / union;
}

export function scoreDuplicatePair({ a, b, aBody, bBody }) {
  const reasons = [];
  let score = 0;
  if ((a.title || "").trim().toLowerCase() === (b.title || "").trim().toLowerCase()) {
    score += 0.5;
    reasons.push("exact normalized title match");
  }
  const bodyScore = jaccard(String(aBody).toLowerCase().split(/\W+/), String(bBody).toLowerCase().split(/\W+/));
  score += bodyScore * 0.4;
  if (bodyScore >= 0.75) reasons.push("strong content overlap");
  return { score: Math.min(1, score), reasons };
}
```

- [ ] **Step 4: Add candidate-pair generation with threshold filtering**

```js
export function findDuplicateCandidates({ rows, threshold }) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const result = scoreDuplicatePair({
        a: rows[i].note,
        b: rows[j].note,
        aBody: rows[i].body,
        bBody: rows[j].body,
      });
      if (result.score >= threshold) {
        out.push({ left: rows[i], right: rows[j], score: result.score, reasons: result.reasons });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 5: Run targeted tests to verify duplicate scoring passes**

Run: `node project-memory/test.mjs`
Expected: PASS for duplicate-score tests

### Task 6: Add `memory_dedup` MCP Tool

**Files:**
- Modify: `project-memory/server.js`
- Modify: `project-memory/test.mjs`
- Consumes: `loadGlobalNotes` from `project-memory/global-index.js`, `findDuplicateCandidates` from `project-memory/dedup.js`
- Produces:
  - MCP tool `memory_dedup`
  - Handler signature: `memory_dedup({ dir?, threshold?, scope? }): Promise<ToolResult>`

**Interfaces:**
- Consumes: global note enumeration and per-note body loading
- Produces: `async dedup(args)` method on `ProjectMemoryServer`

- [ ] **Step 1: Write the failing MCP dedup test**

```js
it("memory_dedup suggests merges without deleting notes", async () => {
  await client.callTool("memory_save", { dir: DEMO, title: "Duplicate JWT", content: "same body same body" });
  await client.callTool("memory_save", { dir: DEMO, title: "Duplicate JWT", content: "same body same body" });
  const r = await client.callTool("memory_dedup", { dir: DEMO, threshold: 0.9 });
  assertIncludes(r.text, "Duplicate JWT");
  assertIncludes(r.text, "suggested merge");
  assert(!/Deleted note/.test(r.text));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node project-memory/test.mjs`
Expected: FAIL with `Unknown tool: memory_dedup`

- [ ] **Step 3: Register the new tool and route calls**

```js
{
  name: "memory_dedup",
  description: "Find likely duplicate notes and suggest non-destructive merges.",
  inputSchema: {
    type: "object",
    properties: {
      dir: { type: "string" },
      threshold: { type: "number", default: 0.9 },
      scope: { type: "string", enum: ["project", "global"], default: "project" }
    }
  }
}

case "memory_dedup": return await this.dedup(args || {});
```

- [ ] **Step 4: Implement minimal dedup handler**

```js
async dedup({ dir, threshold = 0.9, scope = "project" }) {
  const p = this.paths(dir);
  const { loadGlobalNotes } = await import("./global-index.js");
  const { findDuplicateCandidates } = await import("./dedup.js");
  const rows = await loadGlobalNotes(VAULT_ROOT);
  const filtered = scope === "project" ? rows.filter((x) => x.slug === p.slug) : rows;
  const withBodies = await Promise.all(filtered.map(async ({ slug, note }) => {
    const raw = await fs.readFile(path.join(VAULT_ROOT, slug, note.file), "utf8").catch(() => "");
    const { body } = parseFrontmatter(raw);
    return { slug, note, body };
  }));
  const pairs = findDuplicateCandidates({ rows: withBodies, threshold });
  if (!pairs.length) return { content: [{ type: "text", text: `No duplicate suggestions above ${threshold} in ${scope} scope.` }] };
  const lines = [`Duplicate suggestions [threshold=${threshold}, scope=${scope}]:`, ""];
  for (const pair of pairs) {
    lines.push(`- suggested merge: [${pair.left.slug}] ${pair.left.note.title} <-> [${pair.right.slug}] ${pair.right.note.title} (score=${pair.score.toFixed(3)})`);
    lines.push(`  reasons: ${pair.reasons.join(", ")}`);
  }
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
```

- [ ] **Step 5: Run targeted tests to verify non-destructive dedup passes**

Run: `node project-memory/test.mjs`
Expected: PASS for dedup tests; notes remain retrievable via `memory_list`

### Task 7: Add Lazy Backfill and Graph-Aware Boost to Existing Recall Paths

**Files:**
- Modify: `project-memory/server.js`
- Modify: `project-memory/graph.js`
- Modify: `project-memory/test.mjs`

**Interfaces:**
- Consumes: `ensureGraphState`, existing `recall()` ranking pipeline
- Produces:
  - lazy graph-state refresh inside graph-aware tools
  - optional graph boost helper `graphBoost(note, queryTokens): number`

- [ ] **Step 1: Write the failing lazy-backfill test**

```js
it("lazy backfill populates links for old notes on first graph tool use", async () => {
  const save = await client.callTool("memory_save", {
    dir: DEMO,
    title: "Legacy Link Note",
    content: "points to [[Legacy Target]]",
  });
  await client.callTool("memory_save", {
    dir: DEMO,
    title: "Legacy Target",
    content: "target body",
  });
  const id = (save.text.match(/Saved note (\S+)/) || [])[1];
  const p = serverPathsForTest(DEMO); // helper inside test file
  const index = JSON.parse(fs.readFileSync(p.indexFile, "utf8"));
  delete index.notes[id].links;
  fs.writeFileSync(p.indexFile, JSON.stringify(index, null, 2));
  const r = await client.callTool("memory_link", { dir: DEMO, id });
  assertIncludes(r.text, "Legacy Target");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node project-memory/test.mjs`
Expected: FAIL because graph state is not rebuilt automatically

- [ ] **Step 3: Add graph-aware boost helper and lazy refresh**

```js
function graphBoost(note, queryTokens) {
  let score = 0;
  for (const link of note.links || []) {
    for (const token of queryTokens) {
      if (String(link.ref || "").toLowerCase().includes(token)) score += 0.05;
    }
  }
  return Math.min(0.15, score);
}

// inside recall/globalRecall after keyword/semantic score
const graph = graphBoost(note, [...qTokens]);
const total = baseScore + graph;
```

- [ ] **Step 4: Ensure graph-aware tools call `ensureGraphState` before scoring**

```js
const ensured = await ensureGraphState({
  vaultRoot: VAULT_ROOT,
  projectDir: p.projectDir,
  slug: p.slug,
  index,
  noteLoader: loadNoteBody,
});
if (ensured.changed) await this.saveIndex(p, ensured.index);
```

- [ ] **Step 5: Run targeted tests to verify lazy backfill passes**

Run: `node project-memory/test.mjs`
Expected: PASS for lazy-backfill test and no regression in old `memory_recall` tests

### Task 8: Update Docs, Version, and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Test: `project-memory/test.mjs`
- Test: `run-tests.mjs`

**Interfaces:**
- Consumes: completed implementations from Tasks 1–7
- Produces: release-ready docs and version metadata for `1.5.0`

- [ ] **Step 1: Add README tool documentation**

```md
### New in v1.5.0

- `memory_link` resolves wiki-style links like `[[id]]`, `[[title]]`, and `[[project:title]]`
- `memory_global_recall` searches across projects with same-project bias
- `memory_dedup` suggests duplicate-note merges without deleting anything
```

- [ ] **Step 2: Add changelog entry**

```md
## 1.5.0

- add `memory_link` with backlinks and wiki-link resolution
- add `memory_global_recall` with same-project bias and graceful fallback
- add `memory_dedup` with non-destructive duplicate suggestions
- add hybrid lazy/explicit graph backfill behavior
```

- [ ] **Step 3: Bump package version**

```json
{
  "version": "1.5.0"
}
```

- [ ] **Step 4: Run focused project-memory tests**

Run: `node project-memory/test.mjs`
Expected: PASS with all new graph/global/dedup tests green

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all server tests and top-level tests pass

- [ ] **Step 6: Review git diff for release scope sanity**

Run: `git diff -- project-memory README.md CHANGELOG.md package.json`
Expected: only graph/global/dedup/docs/version changes

## Self-Review

### Spec coverage

- `memory_link`: covered by Tasks 1–2 and Task 7
- `memory_global_recall`: covered by Tasks 3–4 and Task 7
- `memory_dedup`: covered by Tasks 5–6
- hybrid backfill: covered by Task 7
- safe non-destructive behavior: covered by Tasks 5–6
- docs/version/release hygiene: covered by Task 8

No spec gaps identified.

### Placeholder scan

- No `TODO` or `TBD` placeholders remain.
- Every task includes file paths, concrete code, and concrete commands.

### Type consistency

- `graph.js` exports are referenced consistently across Tasks 1, 2, and 7.
- `global-index.js` exports are referenced consistently across Tasks 3, 4, and 6.
- `dedup.js` exports are referenced consistently across Tasks 5 and 6.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-v1-5-0-knowledge-graph.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
