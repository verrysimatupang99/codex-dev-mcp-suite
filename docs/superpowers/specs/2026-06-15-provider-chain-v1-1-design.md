# Provider Chain v1.1 Design

## Goal

Add built-in optional provider fallback for `project-memory` and `devjournal` model calls while keeping local-first privacy guarantees and deterministic no-network override.

## User-facing config

Use numbered provider slots so users can configure one provider or many without learning router syntax.

Recommended slots:

```bash
MCP_PROVIDER_PRIMARY=groq
MCP_PROVIDER_PRIMARY_BASE_URL=https://api.groq.com/openai/v1
MCP_PROVIDER_PRIMARY_API_KEY=<groq-key>
MCP_PROVIDER_PRIMARY_MODEL=llama-3.3-70b-versatile

MCP_PROVIDER_CHAIN2=cerebras
MCP_PROVIDER_CHAIN2_BASE_URL=https://api.cerebras.ai/v1
MCP_PROVIDER_CHAIN2_API_KEY=<cerebras-key>
MCP_PROVIDER_CHAIN2_MODEL=llama-3.3-70b

MCP_PROVIDER_CHAIN3=openrouter
MCP_PROVIDER_CHAIN3_BASE_URL=https://openrouter.ai/api/v1
MCP_PROVIDER_CHAIN3_API_KEY=<openrouter-key>
MCP_PROVIDER_CHAIN3_MODEL=openai/gpt-4o-mini
```

Rules:

- `MCP_PROVIDER_PRIMARY` is slot 1.
- `MCP_PROVIDER_CHAIN2`, `MCP_PROVIDER_CHAIN3`, ... are fallback slots.
- If only primary exists, use only primary.
- If users want more, they can add `MCP_PROVIDER_CHAIN4_*`, etc.
- Provider name is a label for logs/docs, not a lock-in. Any OpenAI-compatible provider works if `BASE_URL`, `API_KEY`, and `MODEL` are set.
- Existing `MCP_LLM_*`, `MCP_RERANK_*`, and `MCP_EMBED_*` remain supported as compatibility fallback.

## Recommended providers

Docs recommend Groq, Cerebras, and OpenRouter because they commonly offer free/low-friction tiers and solid model quality. Users may use any provider/model ID.

## Runtime behavior

For chat/rerank calls:

1. If `MCP_DETERMINISTIC_FALLBACK=true`, make no network calls and return keyword/deterministic mode.
2. Build provider list from numbered slots.
3. Try providers in order with the existing timeout.
4. On timeout, 429, 5xx, network error, or invalid JSON: try next provider.
5. On auth error 401/403: log provider label as unavailable and try next provider, without printing key.
6. If all fail: return `null` and let existing keyword fallback handle results.

For embeddings:

- Keep current explicit embedding config in v1.1 unless a provider slot declares an embedding model later.
- Do not guess embedding model from chat model.

## Auto-import/probe

MVP probe is read-only and optional:

- Validate `/chat/completions` compatibility with a tiny low-token request.
- Detect model availability only if provider exposes a safe model list endpoint.
- Never store keys outside the user's MCP client env/config.
- Never send project content during probe.

Future CLI/import helper can generate `.env` snippets, but v1.1 runtime only reads env.

## Privacy and observability

- Default remains offline keyword mode if no provider is configured.
- Deterministic mode overrides provider chain.
- Logs may show provider label and status, never prompts, snippets, API keys, or full response bodies.
- Docs must explain that query text/candidate snippets leave the machine only when provider slots or legacy model envs are configured.

## Compatibility

- Existing installs using `MCP_LLM_BASE_URL`/`MCP_LLM_API_KEY` keep working.
- Existing `MCP_RERANK_*` continues to override generic LLM config for rerank if no numbered provider slots exist.
- Legacy `NINEROUTER_*`, `LLM_*`, `RERANK_*`, and `EMBED_*` aliases remain supported.

## Out of scope for v1.1

- Hosted auth/dashboard.
- Persisted provider credentials.
- Automatic remote model selection based on benchmarks.
- Embedding provider chain.
- Publishing any telemetry.
