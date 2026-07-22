## 1.8.0 - 2026-07-22

### Added
- **Zero-Dependency Local Offline Vector Embedding Engine**:
  - Pure JS 384-dimensional term-frequency hashing vector engine with sublinear $1 + \log(tf)$ scaling and L2 normalization (`project-memory/local-embed.js`).
  - Activated via `MCP_LOCAL_EMBED=true` / `LOCAL_EMBED=true` env flag when no remote embedding API key is available.
  - Sub-millisecond execution, zero network calls, zero external npm dependencies.
  - Full compatibility with existing `cosine(a, b)` and graph ranking in `project-memory`.
- **Universal Multi-Client Guides**:
  - Hermes Agent setup guide (`docs/clients/hermes.md`).
  - Google Antigravity CLI (AGY CLI) setup guide (`docs/clients/antigravity.md`).
  - Claude Code & Generic MCP setup guides (`docs/clients/claude-code.md`, `docs/clients/generic-mcp.md`).
- **Test Suite**: 100/100 unit tests passing (100% green across 8 test suites).

## 1.7.0 - 2026-07-22

### Added
- **Obsidian Vault Parity & MOC Tools**:
  - `memory_moc` Map of Content generator & `.obsidian` vault structure integration.
  - `memory_graph` knowledge graph visualization & backlinks.
- **Codebase Security Audit Tool (`pack_audit`)**:
  - Detect missing `.gitignore`, exposed secrets/keys (`.env`, `.pem`, `id_rsa`), and overly large files.

## 1.5.0

- add `memory_link` with wiki-link resolution for `[[id]]`, `[[title]]`, `[[project:id]]`, and `[[project:title]]`, plus backlink inspection
- add `memory_global_recall` with same-project bias and graceful keyword/semantic fallback across project vaults
- add `memory_dedup` with non-destructive duplicate suggestions for project or global scope
- add hybrid lazy graph backfill so link metadata is derived on first graph-aware use and remains rebuildable from canonical notes
- add graph-aware soft boost in recall paths without making embeddings mandatory
- 36 project-memory tests pass after graph/global/dedup coverage expansion

# Changelog

## 1.4.0 - 2026-06-17

### Added
- **`provider-smoke` CLI** (`bin/provider-smoke.mjs`): probe every configured LLM provider (chat + embeddings) and print a matrix of latency / status / sample. Useful after adding a new API key or comparing providers.
  - Usage: `npx -y -p codex-dev-mcp-suite provider-smoke` (or globally `provider-smoke`)
  - Flags: `--json`, `--markdown`, `--save-md <path>`, `--chat-only`, `--embed-only`, `--env-file <path>`, `--only a,b,c`, `--timeout <ms>`, `--help`, `--version`
  - Auto-detects providers from `MCP_PROVIDER_*` slots + named env (`GROQ_*`, `CEREBRAS_*`, `MISTRAL_*`, `OPENROUTER_*`, `OPENAI_*`, `OLLAMA_*`, `ANTHROPIC_*`, `GEMINI_*`, `COHERE_*`, `VOYAGE_*`, `CLOUDFLARE_*`) + `MCP_LLM_BASE_URL` / `NINEROUTER_URL` fallback.
  - Pure-function library at `lib/provider-smoke.js` (18 offline tests).
  - `KNOWN_PROVIDERS` registry covers 11 providers with `supportsChat` / `supportsEmbed` flags + `endpoint: "openai-compatible" | "cloudflare"`.
  - Cloudflare embed-only models (`@cf/baai/*`, `@cf/google/embedding*`, etc.) are detected and the chat probe is skipped with a clear annotation.
- **Cloudflare Workers AI support** for embeddings: drop-in alternative when 9router/OpenAI are unavailable. Set `MCP_EMBED_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run/`, `MCP_EMBED_API_KEY=<token>`, `MCP_EMBED_MODEL=@cf/baai/bge-base-en-v1.5`.
  - Cloudflare's REST API (non-OpenAI-compatible, model-in-path) is auto-detected by URL pattern and dispatched to a separate code path in `project-memory/embedding.js`.
  - New `isCloudflareURL()` + `httpPostJson()` helpers; `embedCloudflare()` handles `{text: [...]}` body and `{result: {data: [[...]]}}` response.
  - `embeddingConfig().mode` and `recallMode()` helpers expose what retrieval mode is active (`semantic` / `keyword` / `deterministic`).
- **`memory_recall` mode arg** (default `"auto"`): explicit control over fallback behavior. `mode: "semantic"` requires embedding (returns `isError: true` if unavailable), `mode: "keyword"` skips embedding entirely.
- **Recall output annotation** now shows `[semantic+rerank]` / `[keyword+rerank]` when LLM rerank is active, making the active mode fully transparent.
- **Top-level test runner hook** (added in 1.3.0, expanded in 1.4.0): `tests/*.test.mjs` are auto-picked-up by `node run-tests.mjs`.

### Tests
- 85 tests pass (was 60 in v1.3.0): 26 project-memory + 6 checkpoint + 6 context-pack + 11 devjournal + 18 provider-smoke + 9 prune + 9 stats.
- New fallback tests: `mode=keyword` skips semantic, `mode=semantic` without embed key returns isError, default mode=auto, no `+rerank` suffix when rerank disabled.

### Docs
- `docs/providers.md` rewritten: 11-provider matrix, Cloudflare setup caveat, Ollama resource cost, "no API key" graceful degradation notes.
- `README.md` updated: "Memory Recall Modes" section, Cloudflare + Gemini setup examples, 4-mode annotation examples.
- `.env.example` updated: copy-pasteable config blocks for Cloudflare Workers AI and Google Gemini.



## 1.3.0 - 2026-06-17

### Added
- New `stats` CLI: summarize local memory storage across vault / journal / checkpoints. Shows totals, top projects by notes, most recent activity, and temp-slug cleanup candidates.
  - Usage: `npx -y -p codex-dev-mcp-suite stats` (or globally `stats`)
  - Flags: `--root <path>`, `--json`, `--top N`, `--help`, `--version`
  - Pure-function library at `lib/stats.js` (no MCP / no stdio); tested offline.
- New top-level test runner hook: `tests/*.test.mjs` are auto-picked-up by `node run-tests.mjs`.
- New `provider-smoke` CLI: probe every configured LLM provider (chat + embeddings) and print a matrix of latency / status / sample. Useful after adding a new API key or to compare providers.
  - Usage: `npx -y -p codex-dev-mcp-suite provider-smoke`
  - Flags: `--json`, `--markdown`, `--save-md <path>`, `--chat-only`, `--embed-only`, `--env-file <path>`, `--timeout <ms>`
  - Detects providers from `MCP_PROVIDER_*` slots + named env (`GROQ_*`, `CEREBRAS_*`, `MISTRAL_*`, `OPENROUTER_*`, `OPENAI_*`, `OLLAMA_*`, `ANTHROPIC_*`, `GEMINI_*`, `COHERE_*`) + `MCP_LLM_BASE_URL` / `NINEROUTER_URL` fallback.
  - Pure-function library at `lib/provider-smoke.js`; tested offline.
- New docs page `docs/providers.md` — auto-generated smoke matrix from latest run.






### Added
- New `prune` CLI: remove temp project slugs (prefix `tmp.`) from vault, journal, and checkpoints. Default is DRY-RUN — nothing is deleted without `--yes`.
  - Usage: `npx -y -p codex-dev-mcp-suite prune` (or globally `prune`)
  - Flags: `--root <path>`, `--yes`, `--json`, `--help`, `--version`
  - Pure-function library at `lib/prune.js`; tested offline.
  - Safety: refuses to delete any slug that does not start with `tmp.`.
- New MCP tool `memory_stats` on the project-memory server: returns the same summary as the `stats` CLI. Useful for in-session introspection from an MCP client.
  - Args: `root?`, `top?` (default 10), `json?` (default false).



### Added
- **Cloudflare Workers AI support** for embeddings and chat: drop-in alternative when 9router/OpenAI are unavailable. Set `MCP_EMBED_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run/`, `MCP_EMBED_API_KEY=<token>`, `MCP_EMBED_MODEL=@cf/baai/bge-base-en-v1.5`. Cloudflare's REST API (non-OpenAI-compatible) is auto-detected by URL pattern and dispatched to a separate code path in `project-memory/embedding.js`. Includes `isCloudflareURL()` detection + `endpoint: "cloudflare"` field in provider matrix.
- `provider-smoke` CLI: probe Cloudflare alongside OpenAI-compatible providers. Cloudflare chat returns 400 for embed-only models (expected — they don't support chat).

## 1.2.0 - 2026-06-15

### Added
- CLI meta handling for all bins: `--help`, `--version`, and `--doctor` (config diagnostics with API keys redacted) before the stdio server starts.
- Provider diagnostics `providerChainDiagnostics()` that lists active providers with redacted keys and flags incomplete numbered slots.
- Per-provider cooldown on `429`/`5xx`/timeout/network failures via `MCP_PROVIDER_COOLDOWN_MS` (default `60000`).
- CI job that packs the tarball, installs it in a temp dir, and runs each bin `--version`.

### Changed
- Rerank now skips providers that are cooling down and records success/failure outcomes.
- Rerank never logs API keys or response bodies.

## 1.1.0 - 2026-06-15

### Added
- Added optional numbered provider chain for chat/rerank fallback: `MCP_PROVIDER_PRIMARY_*`, `MCP_PROVIDER_CHAIN2_*`, `MCP_PROVIDER_CHAIN3_*`, and higher.
- Added provider-chain tests for ordered fallback, incomplete slot skipping, deterministic disable, and legacy fallback.

## 1.0.1 - 2026-06-15

### Added
- Added neutral `MCP_*` environment variables for model configuration:
  - `MCP_LLM_BASE_URL`, `MCP_LLM_API_KEY`
  - `MCP_RERANK_BASE_URL`, `MCP_RERANK_API_KEY`, `MCP_RERANK_MODEL`
  - `MCP_EMBED_BASE_URL`, `MCP_EMBED_API_KEY`, `MCP_EMBED_MODEL`
- Added client-agnostic docs:
  - `docs/configuration.md`
  - `docs/clients/codex.md`
  - `docs/clients/claude-code.md`
  - `docs/clients/generic-mcp.md`
- Added tests proving `MCP_*` env vars override legacy aliases.
- Added `MCP_DETERMINISTIC_FALLBACK` hard no-network mode for deterministic local-only recall.
- Added `docs/privacy.md` covering local storage, data flow, and remote provider boundaries.
- Added provider guidance for Groq, Cerebras, and OpenRouter as optional external endpoints.

### Changed
- README now presents the project as **Dev MCP Suite** while keeping the npm package name `codex-dev-mcp-suite` for compatibility.
- Rerank and embedding helpers now describe any OpenAI-compatible endpoint, not 9Router only.
- `.env.example` now recommends `MCP_*` names for new installs.
- `memory_recall`, `journal_search`, and `memory_reindex` now explicitly respect deterministic no-network mode.

### Compatibility
- Legacy env names remain supported: `LLM_*`, `NINEROUTER_*`, `EMBED_*`, and `RERANK_*`.
- Offline keyword search remains the default if no model endpoint is configured.

## [1.7.0] - 2026-07-14 — Obsidian-grade vault (feat/obsidian-grade-vault)
### Added (project-memory)
- `memory_moc` — generate/refresh Obsidian-style Map of Content (`MOC.md`): all notes as wikilinks, `#tag` index, and backlink graph. Auto-refreshed on every save/delete.
- `memory_graph` — export note graph (nodes + directed edges from `[[wikilinks]]`) as JSON for external graph views.
- Auto-bootstrap `.obsidian/` workspace (`app.json` + `workspace.json`) on first save, so the vault opens directly in the Obsidian app with graph view + tag pages.
- MOC regenerates automatically after `memory_save` and `memory_delete`.

## [1.8.0] - 2026-07-14 — Vibecoder ergonomics (P1/P2, feat/obsidian-grade-vault)
### Added (project-memory)
- Auto-resolve `[[wikilinks]]` + backlinks immediately on `memory_save` (graph fresh without waiting for recall).
- Per-tag index pages: `tags/<tag>.md` emitted alongside MOC, pruned when tag empties.
- `aliases` field on notes (Obsidian-style); `[[alias]]` now resolves via `resolveLink`.
### Added (devjournal)
- `journal_daily` — Obsidian-style daily note (`daily/YYYY-MM-DD.md`); read or append mode.
- `journal_log` now auto-appends a line to today's daily note.
