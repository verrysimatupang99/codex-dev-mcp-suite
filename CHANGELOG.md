# Changelog

## 1.3.0 - 2026-06-17

### Added
- New `stats` CLI: summarize local memory storage across vault / journal / checkpoints. Shows totals, top projects by notes, most recent activity, and temp-slug cleanup candidates.
  - Usage: `npx -y -p codex-dev-mcp-suite stats` (or globally `stats`)
  - Flags: `--root <path>`, `--json`, `--top N`, `--help`, `--version`
  - Pure-function library at `lib/stats.js` (no MCP / no stdio); tested offline.
- New top-level test runner hook: `tests/*.test.mjs` are auto-picked-up by `node run-tests.mjs`.




### Added
- New `prune` CLI: remove temp project slugs (prefix `tmp.`) from vault, journal, and checkpoints. Default is DRY-RUN — nothing is deleted without `--yes`.
  - Usage: `npx -y -p codex-dev-mcp-suite prune` (or globally `prune`)
  - Flags: `--root <path>`, `--yes`, `--json`, `--help`, `--version`
  - Pure-function library at `lib/prune.js`; tested offline.
  - Safety: refuses to delete any slug that does not start with `tmp.`.
- New MCP tool `memory_stats` on the project-memory server: returns the same summary as the `stats` CLI. Useful for in-session introspection from an MCP client.
  - Args: `root?`, `top?` (default 10), `json?` (default false).

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
