# Hardening v1.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CLI UX (help/version/doctor), secret redaction, provider validation, per-provider timeout + 429/5xx cooldown, and a packaged-tarball CI smoke test, without breaking existing behavior.

**Architecture:** Add a shared bin meta-handler that intercepts `--help/--version/--doctor` before starting the stdio server. Add redaction + provider diagnostics + cooldown helpers in the provider layer. Wire rerank chat calls through cooldown-aware provider iteration. Extend CI with a tarball install smoke job.

**Tech Stack:** Node.js ESM, existing MCP SDK servers, built-in `http`/`https`, offline test harness, GitHub Actions.

---

### Task 1: Bin CLI Meta (help/version/doctor)

**Files:**
- Create: `bin/_meta.mjs`
- Modify: `bin/project-memory.mjs`, `bin/devjournal.mjs`, `bin/checkpoint.mjs`, `bin/context-pack.mjs`

- [ ] Add `handleCliMeta({ bin, title, serverDir })` that handles `-h/--help`, `-v/--version`, `--doctor` then exits; returns false otherwise.
- [ ] Read version from root `package.json`.
- [ ] `--doctor` prints storage + model/provider config with API keys redacted (never raw values).
- [ ] Each bin calls meta first, then imports its server only when not handled.

### Task 2: Redaction + Provider Diagnostics + Cooldown

**Files:**
- Modify: `project-memory/provider-chain.js`, `devjournal/provider-chain.js`

- [ ] Add `redactKey(value)` returning `set (<n> chars)` / `not set`, never the value.
- [ ] Add `providerChainDiagnostics()` listing active providers (redacted) and incomplete-slot issues.
- [ ] Add pure cooldown helpers `recordOutcome(key, ok, now)` and `isCoolingDown(key, now)` using `MCP_PROVIDER_COOLDOWN_MS` (default 60000).

### Task 3: Cooldown-Aware Rerank

**Files:**
- Modify: `project-memory/rerank.js`, `devjournal/rerank.js`

- [ ] Make provider chat return status so 429/5xx/network failures are retryable.
- [ ] Skip providers currently cooling down; record outcomes.
- [ ] Stop after first success; fall back to keyword if all fail. Never log keys/bodies.

### Task 4: Tests

**Files:**
- Modify: `project-memory/test.mjs`, `devjournal/test.mjs`

- [ ] Test `providerChainDiagnostics()` flags an incomplete slot and redacts keys.
- [ ] Test cooldown helpers: failure starts cooldown, expiry clears it, success clears it.
- [ ] Test bin `--version` prints package version and `--doctor` output excludes raw key value.

### Task 5: CI Tarball Smoke + Verify

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `CHANGELOG.md`, `package.json`, `docs/configuration.md`, `.env.example`

- [ ] Add CI job: `npm pack`, install tarball in temp dir, run each bin `--version`.
- [ ] Document `--doctor` and `MCP_PROVIDER_COOLDOWN_MS`.
- [ ] Bump version to 1.2.0 and add changelog entry.
- [ ] Run `npm test` and `npm pack --dry-run`; expect all pass.
