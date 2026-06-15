# Changelog

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
