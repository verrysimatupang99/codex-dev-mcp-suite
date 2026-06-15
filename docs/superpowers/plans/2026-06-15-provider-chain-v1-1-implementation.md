# Provider Chain v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional numbered OpenAI-compatible provider fallback for rerank/chat calls while preserving deterministic no-network mode and legacy env compatibility.

**Architecture:** Add focused provider-chain helpers to `project-memory` and `devjournal`, then route existing rerank chat calls through those helpers. Provider slots are built from `MCP_PROVIDER_PRIMARY_*`, `MCP_PROVIDER_CHAIN2_*`, `MCP_PROVIDER_CHAIN3_*`, etc.; if absent, existing `MCP_RERANK_*`/`MCP_LLM_*`/legacy config is used.

**Tech Stack:** Node.js ESM, existing MCP SDK servers, built-in `http`/`https`, existing offline test harness.

---

### Task 1: Provider Chain Helpers

**Files:**
- Create: `project-memory/provider-chain.js`
- Create: `devjournal/provider-chain.js`
- Test: `project-memory/test.mjs`
- Test: `devjournal/test.mjs`

- [ ] Create a `providerEnv(slotPrefix)` helper that reads `NAME`, `BASE_URL`, `API_KEY`, and `MODEL` from a prefix such as `MCP_PROVIDER_PRIMARY`.
- [ ] Create `providerChainConfig()` returning `{ providers, enabled, deterministic }`.
- [ ] Include `MCP_PROVIDER_PRIMARY` first when complete.
- [ ] Include every complete numbered slot matching `MCP_PROVIDER_CHAIN<N>` in numeric order for `N >= 2`.
- [ ] Fall back to one legacy provider from existing rerank/LLM envs when no numbered slots exist.
- [ ] Return disabled config if deterministic mode is on.
- [ ] Add tests for primary-only, primary+chain2+chain3 ordering, arbitrary chain4, incomplete slot skip, deterministic disable, and legacy fallback.

### Task 2: Rerank Uses Provider Chain

**Files:**
- Modify: `project-memory/rerank.js`
- Modify: `devjournal/rerank.js`
- Test: existing `npm test`

- [ ] Replace single `BASE`/`KEY`/`MODEL` request selection with `providerChainConfig()`.
- [ ] Try providers in order for each chat request.
- [ ] Return first valid OpenAI-compatible response.
- [ ] On non-200, timeout, network error, invalid JSON, or SSE parse failure, try the next provider.
- [ ] Keep returning `null` if every provider fails so keyword fallback still works.
- [ ] Never log API keys or response bodies.

### Task 3: Docs and Examples

**Files:**
- Modify: `docs/configuration.md`
- Modify: `docs/privacy.md`
- Modify: `.env.example`
- Modify: `CHANGELOG.md`
- Modify: `README.md` if needed

- [ ] Document numbered provider slots.
- [ ] Document Groq/Cerebras/OpenRouter as recommended examples, not required providers.
- [ ] Clarify users can use any OpenAI-compatible base URL, token, and model ID.
- [ ] Clarify deterministic mode overrides provider chain.
- [ ] Add changelog entry for v1.1 unreleased.

### Task 4: Verification

**Files:**
- No source changes.

- [ ] Run `npm test` and expect 33+ tests all pass.
- [ ] Run `npm pack --dry-run` and confirm runtime provider-chain helpers are included.
- [ ] Run secret scan on changed/staged files and confirm no real secrets.
