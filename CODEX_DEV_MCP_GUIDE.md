# Codex Dev MCP Suite — Solo Dev / Vibecoder Toolkit

Built for sessions that hit "input too long" / get compacted, so you can stop
copy-pasting context across sessions. All servers are local, file-based, and
split storage per-project (by directory path hash), so projects never mix.

Servers live in `~/.codex/mcp-servers/<name>/` and are registered in
`~/.codex/config.toml`. Restart/reload Codex to load them.

Shared storage root: `~/.codex/memories/`
- `memories/vault/`        → project-memory notes
- `memories/checkpoints/`  → checkpoint snapshots
- `memories/journal/`      → devjournal logs + handoffs

`dir` argument defaults to the current working directory on every tool, so in
normal use you don't pass it — context auto-separates per project folder.

--------------------------------------------------------------------------------
## 1) project-memory — searchable Markdown knowledge vault
Obsidian-style `.md` notes + Context7-style on-demand recall (keyword index).

Tools:
- memory_save   {title, content, tags?, kind?, dir?}  → save + auto-index a note
- memory_recall {query, limit?, full?, dir?}          → pull most relevant notes
- memory_list   {limit?, dir?}                          → list notes (newest first)
- memory_get    {id, dir?}                              → full Markdown of one note
- memory_delete {id, dir?}                              → remove a note

Use it for: durable knowledge — decisions, gotchas, API quirks, snippets.
Recall is keyword-based (fast, local, no embeddings).

Example flow:
1. After solving something: memory_save title="Fix CORS on /api" content="..." tags=["cors","api"]
2. Next session: memory_recall query="how did we fix cors" → returns that note.

--------------------------------------------------------------------------------
## 2) devjournal — session timeline + handoff/resume (anti-compaction)
The key tool for your "session penuh / limit" problem.

Tools:
- journal_log          {title, body?, type?, dir?}   type: note|decision|blocker|done|idea
- journal_handoff      {summary, next_steps?, open_questions?, active_files?, dir?}
- journal_resume       {recent?, dir?}               → latest handoff + recent entries
- journal_timeline     {limit?, type?, dir?}
- journal_search       {query, limit?, dir?}      → relevance search (rerank/keyword)
- journal_clear_handoff {dir?}

Use it for: never losing your place.
- BEFORE a session ends / before context compacts: journal_handoff with what you
  did + next steps + active files.
- START of a new session: journal_resume → instantly rebuild context, no paste.

Storage is append-only `journal.jsonl` + human-readable `journal.md` mirror +
canonical `handoff.json`.

--------------------------------------------------------------------------------
## 3) checkpoint — git-independent file snapshots (safe vibecoding)
Snapshot/restore project text files so you can experiment freely and roll back.

Tools:
- checkpoint_create  {label?, dir?}        → snapshot all text files now
- checkpoint_list    {dir?}
- checkpoint_diff    {id, dir?}            → added / modified / deleted vs now
- checkpoint_restore {id, clean?, dir?}    → revert files (clean=true also removes new files)
- checkpoint_delete  {id, dir?}

Use it for: "let me try a wild refactor" without committing to git.
- checkpoint_create label="before experiment"
- ...make changes...
- checkpoint_diff <id> to see what moved, checkpoint_restore <id> to undo.

Notes/limits: skips binary files and files >2MB; ignores node_modules/.git/
build dirs; caps at 4000 files. Content-addressed storage dedupes unchanged files.

--------------------------------------------------------------------------------
## 4) context-pack — token-efficient project briefing
Get oriented in a project without dumping files into context.

Tools:
- pack_overview {include_readme?, dir?}        → stack, scripts, key files, top dirs, README excerpt
- pack_tree     {max_depth?, max_entries?, dir?}
- pack_outline  {file, dir?}                   → top-level functions/classes/exports only
- pack_search   {query, limit?, dir?}          → fast path/filename match

Use it for: session start in an unfamiliar/large repo. pack_overview first,
then pack_outline on the few files that matter — far cheaper than reading whole files.
Detects: Node/JS (+ Next/React/Vue/Svelte/Express/TS/Tailwind/Prisma/Vite),
Python, Rust, Go, Java/JVM, PHP, Ruby, Docker.

--------------------------------------------------------------------------------
## Recommended daily loop
1. Session start:  context-pack.pack_overview  +  devjournal.journal_resume  +  memory_recall (topic)
2. Before risky change:  checkpoint.checkpoint_create
3. While working:  memory_save (durable facts), journal_log (events/blockers)
4. Session end / context about to compact:  journal_handoff

## Maintenance
- All data is plain files under ~/.codex/memories/ — back up or inspect freely.
- To wipe one project's data, delete its slug folder under each store.
- Env overrides: MEMORY_VAULT_DIR, CHECKPOINT_DIR, JOURNAL_DIR.

================================================================================
## UPGRADE 1 — Semantic (embedding) recall in project-memory
project-memory now stores a semantic embedding per note and uses it for recall
when available. Hybrid scoring: 0.8 * cosine(semantic) + 0.2 * keyword.

- Embeddings via 9router (`/v1/embeddings`), model `bm/baai/bge-m3`.
- Configured in config.toml under [mcp_servers.project-memory.env]:
  NINEROUTER_URL, NINEROUTER_KEY, EMBED_MODEL, EMBED_TIMEOUT_MS.
- GRACEFUL FALLBACK: if the embedding endpoint is unavailable (e.g. 503 "no
  channel"), recall automatically falls back to keyword search. Nothing breaks.
- memory_recall output is tagged with the mode used: [semantic] or [keyword],
  and per-note shows sim:0.xxx (semantic) or score:N (keyword).

New tool:
- memory_reindex {force?, dir?} → backfill embeddings for notes that don't have
  one yet. Run it once the bge-m3 channel is live on your 9router so old notes
  become semantically searchable. Safe to run repeatedly; force=true re-embeds all.

Status note: at build time the bge-m3 channel returned 503, so notes are saved
keyword-only and recall runs in [keyword] mode. The moment the channel is up,
new saves embed automatically and `memory_reindex` upgrades old ones — no code
changes needed.

To override the embedding model/endpoint: set EMBED_MODEL / NINEROUTER_URL /
NINEROUTER_KEY (or EMBED_URL / EMBED_KEY) in the env block.

================================================================================
## UPGRADE 2 — auto-capture plugin (hooks)
A Codex plugin that removes the manual step of pasting context across sessions.

Marketplace: `codex-dev-suite` (local) at
  ~/.codex/marketplaces/codex-dev-suite
Plugin: `auto-capture` (installed + enabled).

What it does:
- SessionStart (matcher: startup|clear|compact|resume): runs
  scripts/session-start.sh, which finds the devjournal handoff + recent entries
  for the CURRENT project (same slug algorithm as the MCP servers) and prints
  them to stdout so Codex injects them as context. This is the anti-compaction
  piece: after a compact/clear/resume, your handoff reappears automatically.
- PostToolUse (async, throttled): runs scripts/post-tool.sh, which counts tool
  calls per project and, after >=25 calls and at most once per 30 min, emits a
  short reminder to call journal_handoff / memory_save so work survives compaction.

Trust: Codex requires you to TRUST the hook the first time. On your next session
start in a trusted project, Codex will prompt to trust the auto-capture hook —
approve it once. (Advanced/automation only: `--dangerously-bypass-hook-trust`.)

Tuning (env, optional):
- AUTOCAP_THROTTLE   seconds between nudges (default 1800)
- AUTOCAP_STATE_DIR  where call counters live (default ~/.codex/memories/.autocap)

Manage:
- codex plugin list | grep auto-capture
- codex plugin remove auto-capture@codex-dev-suite
- Edit scripts under ~/.codex/marketplaces/codex-dev-suite/plugins/auto-capture/
  then re-run `codex plugin marketplace add ~/.codex/marketplaces/codex-dev-suite`
  and `codex plugin add auto-capture@codex-dev-suite` to refresh the cached copy.

How the pieces fit:
  auto-capture (SessionStart) --reads--> devjournal handoff --so--> you resume instantly
  auto-capture (PostToolUse)  --reminds--> you to journal_handoff / memory_save
  project-memory.memory_recall --semantic/keyword--> durable facts on demand

================================================================================
## Testing
A dependency-free test suite covers all four servers (26 tests).

Run everything:
  cd ~/.codex/mcp-servers && node run-tests.mjs

Run one server:
  cd ~/.codex/mcp-servers/<server> && npm test

Layout:
- _testkit/harness.mjs   shared MCP stdio client + tiny assert/test runner
- <server>/test.mjs      per-server tests (spawn server, call tools, assert)
- run-tests.mjs          runs all suites, prints combined summary

Tests run fully offline (project-memory forces keyword mode by passing an empty
embedding key), use temp dirs, and clean up after themselves — safe to run anytime.

================================================================================
## Backfill — import past Codex sessions
Imports your existing Codex session history (~/.codex/sessions/*.jsonl) into
project-memory + devjournal, grouped by each session's cwd (project).

USE backfill-sessions-v2.mjs (see "Backfill v2" below). The original v1 script
and its state file (.backfill-state.json) have been removed in favor of v2,
which extracts deeper content (commands, plan, files, tool counts) and backdates
entries to the original session time.

Embeddings: backfill runs with embeddings OFF (keyword-only) for speed. Once the
bge-m3 channel on 9router is live, run memory_reindex per project to upgrade old
notes to semantic search. (LLM rerank still works in the meantime — see UPGRADE 3/4.)

================================================================================
## UPGRADE 3 — LLM rerank (Kiro) when embeddings are unavailable
Since the bge-m3 embedding channel is currently 503, project-memory now has a
middle tier between semantic and keyword: an LLM reranker using a 9router chat
model (default Kiro `kr/claude-haiku-4.5`).

Recall mode precedence (auto-selected, shown in output as [mode]):
1. [semantic] — if note embeddings + query embedding are available (bge-m3)
2. [rerank]   — keyword prefilter (top ~20; falls back to most-recent if no
                keyword hit) → chat model picks/orders the most relevant → ids
3. [keyword]  — pure keyword scoring (always-available fallback)

Why this matters: rerank handles semantic queries with zero keyword overlap.
Example: query "how do users sign in securely with tokens" correctly returns a
note titled "JWT auth flow" — no shared words.

Config (config.toml, [mcp_servers.project-memory.env]):
  RERANK_MODEL = "kr/claude-haiku-4.5"   # any 9router chat model id
  RERANK_TIMEOUT_MS = "30000"
  RERANK_ENABLED = "1"                    # set "0" to force keyword-only

Files: rerank.js (chat client + parser), wired into server.js recall().
Graceful: any failure/timeout/non-200 falls back to keyword. Never throws.

Cost note: rerank makes ONE small chat call per recall (haiku, temp 0,
~200 max tokens). Cheap, but it does use your 9router quota. Disable with
RERANK_ENABLED=0 if you want zero-cost keyword-only recall.

Tests: project-memory/test.rerank.mjs (online; auto-skips if 9router is down).

================================================================================
## UPGRADE 4 — devjournal journal_search (rerank)
devjournal now has a relevance search tool, mirroring project-memory's rerank:

- journal_search {query, limit?, dir?}
  Keyword prefilter over journal entries, then LLM rerank (9router Kiro
  kr/claude-haiku-4.5) when available; else keyword scoring. Output tagged
  [rerank] or [keyword]. Falls back to recent entries for semantic-style
  queries with no keyword overlap.

journal_resume is intentionally unchanged — it returns the canonical latest
handoff + recent entries (no query). Use journal_search when you want to find
entries about a specific topic across past sessions.

Files: devjournal/rerank.js (same module as project-memory), wired into
devjournal/server.js. Same env knobs apply (RERANK_MODEL / RERANK_ENABLED /
RERANK_TIMEOUT_MS); they're already set in config.toml for project-memory, and
devjournal reads NINEROUTER_URL/KEY from its own env block — note: enable rerank
for devjournal by adding the RERANK_* + NINEROUTER_* vars to
[mcp_servers.devjournal.env] too (see below).

================================================================================
## Backfill v2 — deep extraction + original timestamps
backfill-sessions-v2.mjs supersedes v1. Per session it now extracts:
- all user prompts, the plan steps (update_plan), shell commands run, files
  touched (apply_patch paths + cat/rm/cp/redirect heuristics), tool usage
  counts, turn/command/reasoning counts, and the final assistant note.
- The note is BACKDATED to the session's original start time.

New tool args enabling this:
- memory_save  ... created: "<ISO>"   # backdate the note
- journal_log  ... ts: "<ISO>"        # backdate the entry

Usage:
  cd ~/.codex/mcp-servers
  node backfill-sessions-v2.mjs --dry --min-prompts 2     # preview deep extract
  node backfill-sessions-v2.mjs --min-prompts 2 --wipe    # replace old session
                                                          # entries, re-import deep
  node backfill-sessions-v2.mjs --min-prompts 2           # incremental (new only)

--wipe removes existing kind/type=="session" entries (from any prior backfill)
before re-importing, so you don't get duplicates. Source of truth is always
~/.codex/sessions, so this is reversible.

State: ~/.codex/memories/.backfill-v2-state.json (separate from v1).
Result: 87 sessions re-imported with original timestamps (2026-03-16 .. 2026-06-13),
0 errors; timestamps verified 87/87 matching original session dates.

================================================================================
## UPGRADE 5 — project-memory resources (browsable notes)
project-memory now also exposes every saved note as a read-only MCP resource,
so notes can be browsed/opened without calling a tool.

- Capability: declares `resources` alongside `tools`.
- resources/list → one entry per note across ALL projects in the vault, with
  name (title), description ([kind] tags — created), mimeType text/markdown.
- resources/read → full Markdown of a note.
- URI scheme: memory://<project-slug>/<noteId>

Note on naming: the MCP server id is `project-memory` (hyphen), as written in
config.toml. Some UIs show a tool namespace like `project_memory` (underscore) —
that label is NOT the server id. Resource/admin calls must target the real id
`project-memory`.

checkpoint / context-pack / devjournal remain tools-only by design (they're
actions, not browsable data). devjournal entries are best queried via
journal_search / journal_timeline.

Verified: resources/list returned all current notes; resources/read returned a
note's Markdown. Full test suite still 27/27.
