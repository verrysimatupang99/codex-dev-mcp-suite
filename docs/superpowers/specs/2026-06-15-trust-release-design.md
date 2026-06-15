# Trust Release Design

**Project:** Dev MCP Suite (`codex-dev-mcp-suite`)  
**Target release:** `v1.0.1` trust release  
**Future release:** `v1.1` built-in provider chain

## Goal

Make Dev MCP Suite safe and understandable for new users by making privacy, local storage, optional model providers, and deterministic no-network behavior explicit.

## Problem

Calon pengguna punya kegelisahan wajar:

1. Mereka takut data proyek/memory/journal dikirim ke author/package owner.
2. Mereka tidak selalu pakai Codex; client bisa Claude Code, Cursor, Gemini-compatible launcher, Hermes, atau MCP host lain.
3. Mereka perlu rekomendasi provider model yang jelas kalau ingin recall/rerank lebih bagus.
4. Mereka perlu mode deterministic/no-network yang eksplisit, bukan sekadar fallback implisit.

## Principles

- **Local-first by default:** fresh install works without model provider or network calls.
- **No hidden telemetry:** package has no hosted backend and no built-in telemetry.
- **Opt-in remote model calls:** data leaves machine only if user configures external embedding/rerank provider.
- **Precise privacy claims:** avoid overclaiming; document exact data flow.
- **Client-agnostic:** docs refer to MCP clients/agents generally; Codex is one supported client, not the product identity.
- **Deterministic means no network:** if enabled, LLM/embedding/rerank calls are hard-disabled.

## v1.0.1 Scope

### Privacy documentation

Add `docs/privacy.md` with this core statement:

> Dev MCP Suite has no built-in telemetry and no hosted backend. Your project memory, journal, and checkpoints are stored as local files on your machine. Data leaves your machine only if you configure an external embedding or rerank provider.

The doc must explain:

- What is stored locally:
  - project-memory notes
  - devjournal entries/handoffs
  - checkpoints
  - context-pack reads only; it does not persist project files
- Who can access it:
  - local OS user and tools with filesystem permission
  - not the package author/owner
- When data leaves the machine:
  - only external `MCP_*` model endpoints for embedding/rerank
  - only the text sent for that feature call
- What never happens by default:
  - no telemetry
  - no hosted backend
  - no automatic upload to repo/npm/author
- Security caveats:
  - vault/journal/checkpoints are plaintext local files
  - do not store secrets unless intentionally desired
  - if using remote model providers, review their privacy policies

### Deterministic mode

Add `MCP_DETERMINISTIC_FALLBACK=true`.

Behavior:

- In `project-memory`:
  - `memory_recall` does not call embeddings.
  - `memory_recall` does not call rerank LLM.
  - `memory_reindex` should report deterministic/no-network mode instead of attempting embeddings.
  - recall output uses `[deterministic]` label.
- In `devjournal`:
  - `journal_search` does not call rerank LLM.
  - search output uses `[deterministic]` label.
- Existing fallback behavior remains:
  - if env is not true and no provider is configured, fallback remains `[keyword]`.
  - if env is not true and provider fails, fallback remains `[keyword]`.

Accepted true values: `true`, `1`, `yes`, `on` case-insensitive.

### Provider recommendation docs

Add provider setup section in `docs/configuration.md`:

Recommended external provider strategy for users who want better recall/rerank:

1. **Groq** as primary fast rerank provider.
2. **Cerebras** as secondary fast fallback.
3. **OpenRouter** as broad model fallback.

For `v1.0.1`, this is docs-only. Users should wire the chain through an OpenAI-compatible gateway they control, such as LiteLLM or 9router, then point Dev MCP Suite at that gateway with:

```env
MCP_LLM_BASE_URL=http://localhost:4000/v1
MCP_LLM_API_KEY=...
MCP_RERANK_MODEL=...
```

Docs must say this chain is optional and disabled by default.

### README updates

README must include:

- one local-first privacy paragraph
- link to `docs/privacy.md`
- link to provider config docs
- clear deterministic example:

```env
MCP_DETERMINISTIC_FALLBACK=true
```

### Tests

Add tests for:

- `MCP_DETERMINISTIC_FALLBACK=true` disables project-memory embedding/rerank and labels recall `[deterministic]`.
- `MCP_DETERMINISTIC_FALLBACK=true` disables devjournal rerank and labels search `[deterministic]`.
- env parsing accepts `true`, `1`, `yes`, `on`.

## v1.1 Future Scope: Built-In Provider Chain

Built-in chain is attractive but out of scope for `v1.0.1` because it expands the trust/security surface.

Future opt-in design:

```env
MCP_PROVIDER_CHAIN=groq,cerebras,openrouter
GROQ_API_KEY=...
CEREBRAS_API_KEY=...
OPENROUTER_API_KEY=...
```

Behavior:

1. Try Groq.
2. On rate limit/error/timeout, try Cerebras.
3. On failure, try OpenRouter.
4. On total failure, fallback deterministic local.

Requirements before v1.1 implementation:

- provider-specific default models
- retry/backoff and timeout policy
- redacted logging
- tests with mocked HTTP endpoints
- docs explaining exactly what text is sent to which provider
- opt-in only; no built-in chain unless `MCP_PROVIDER_CHAIN` is set

## Non-Goals

- Do not publish under a new package name in `v1.0.1`.
- Do not add telemetry.
- Do not add a hosted backend.
- Do not implement built-in Groq/Cerebras/OpenRouter chain in `v1.0.1`.
- Do not make remote model calls by default.

## Acceptance Criteria

- Fresh install works offline with deterministic/keyword local recall.
- Users can read a privacy doc and understand exactly where data is stored and when it leaves their machine.
- `MCP_DETERMINISTIC_FALLBACK=true` hard-disables all model network calls in suite recall/search paths.
- Tests pass.
- `npm pack --dry-run` includes public docs and excludes internal planning docs.
- Secret scan finds no real secrets.
