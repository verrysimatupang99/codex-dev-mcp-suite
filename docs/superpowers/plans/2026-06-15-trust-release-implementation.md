# Trust Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved v1.0.1 trust release: privacy docs, deterministic no-network mode, provider recommendation docs, tests, and publish readiness checks.

**Architecture:** Add a tiny shared environment parser for deterministic mode in each server area that needs it, then gate embedding/rerank call paths before any network request is attempted. Documentation explains data flow and optional provider setup without enabling remote calls by default.

**Tech Stack:** Node.js MCP servers, Markdown docs, existing offline MCP test harness.

---

### Task 1: Deterministic Mode Code

**Files:**
- Modify: `project-memory/server.js`
- Modify: `project-memory/embedding.js`
- Modify: `project-memory/rerank.js`
- Modify: `devjournal/server.js`
- Modify: `devjournal/rerank.js`

- [ ] Add `deterministicEnabled()` helper that accepts `true`, `1`, `yes`, `on` case-insensitive.
- [ ] In project-memory, skip embedding and rerank when deterministic is enabled.
- [ ] In project-memory, label recall results `[deterministic]` when deterministic is enabled.
- [ ] In project-memory, make reindex report deterministic/no-network instead of attempting embeddings.
- [ ] In devjournal, skip rerank and label search `[deterministic]` when deterministic is enabled.

### Task 2: Deterministic Tests

**Files:**
- Modify: `project-memory/test.mjs`
- Modify: `devjournal/test.mjs`

- [ ] Add project-memory test proving deterministic mode labels recall `[deterministic]`.
- [ ] Add project-memory test proving reindex reports deterministic/no-network.
- [ ] Add devjournal test proving deterministic mode labels search `[deterministic]`.
- [ ] Add env parsing test for `true`, `1`, `yes`, `on`.

### Task 3: Trust Docs

**Files:**
- Create: `docs/privacy.md`
- Modify: `docs/configuration.md`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] Add privacy/data-flow doc.
- [ ] Add deterministic env docs.
- [ ] Add Groq/Cerebras/OpenRouter docs-only provider strategy.
- [ ] Include `docs/privacy.md` in npm package files.
- [ ] Update changelog with trust-release items.

### Task 4: Verification

**Files:**
- No code files.

- [ ] Run `npm test` and expect all tests pass.
- [ ] Run `npm pack --dry-run` and confirm public docs included, internal plans/specs excluded.
- [ ] Run secret scan and confirm no real secrets.
