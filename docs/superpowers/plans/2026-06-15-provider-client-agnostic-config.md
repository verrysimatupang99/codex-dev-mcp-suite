# Provider- and Client-Agnostic Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MCP suite configurable for any OpenAI-compatible gateway and document usage beyond Codex.

**Architecture:** Keep backward compatibility with existing `NINEROUTER_*` env vars while introducing neutral `MCP_*` env names. Documentation separates generic install, provider config, and client-specific config examples.

**Tech Stack:** Node.js MCP servers, OpenAI-compatible HTTP APIs for embeddings/rerank, Markdown docs.

---

### Task 1: Neutral Provider Env Aliases

**Files:**
- Modify: `project-memory/embedding.js`
- Modify: `project-memory/rerank.js`
- Modify: `devjournal/rerank.js`
- Test: existing `npm test`

- [ ] Add `MCP_EMBED_BASE_URL`, `MCP_EMBED_API_KEY`, `MCP_EMBED_MODEL` with fallback to existing `NINEROUTER_URL`, `NINEROUTER_KEY`, `EMBED_MODEL`.
- [ ] Add `MCP_LLM_BASE_URL`, `MCP_LLM_API_KEY`, `MCP_RERANK_MODEL` with fallback to existing `NINEROUTER_URL`, `NINEROUTER_KEY`, `RERANK_MODEL`.
- [ ] Keep default disabled behavior when no key/url/model is configured.
- [ ] Run `npm test` and expect all tests pass.

### Task 2: Client-Agnostic Docs

**Files:**
- Create: `docs/configuration.md`
- Create: `docs/clients/codex.md`
- Create: `docs/clients/claude-code.md`
- Create: `docs/clients/generic-mcp.md`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] Document neutral env names and legacy aliases.
- [ ] Provide Codex TOML config using npm bin commands.
- [ ] Provide Claude Code MCP JSON config using npm bin commands.
- [ ] Provide generic MCP JSON config.
- [ ] Update README to call the suite “Dev MCP Suite” while preserving package name.
- [ ] Run tests again after docs changes.
