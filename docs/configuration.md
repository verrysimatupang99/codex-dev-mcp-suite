# Configuration

Dev MCP Suite is MCP-client agnostic. The servers run locally over stdio and work in any client that can launch MCP servers: Codex CLI, Claude Code, Cursor, Cline, Gemini-compatible launchers, Hermes, and generic MCP hosts.

## Storage

All storage is local and file-based.

| Env var | Used by | Default |
|---|---|---|
| `MEMORY_VAULT_DIR` | `project-memory` | `~/.codex/memories/vault` |
| `JOURNAL_DIR` | `devjournal` | `~/.codex/memories/journal` |
| `CHECKPOINT_DIR` | `checkpoint` | `~/.codex/memories/checkpoints` |

Use a different base path if your MCP client is not Codex, for example `~/.local/share/dev-mcp-suite/...`.

## Optional model features

`context-pack` and `checkpoint` never need a model. `project-memory` and `devjournal` work offline by keyword search and can optionally use an OpenAI-compatible API for better recall.

No remote calls are made unless you configure a model endpoint. For strict local-only behavior even when model env vars are present, set `MCP_DETERMINISTIC_FALLBACK=true`.

| Env var | Purpose |
|---|---|
| `MCP_LLM_BASE_URL` | Base URL for an OpenAI-compatible API, e.g. `http://localhost:11434/v1` or `http://localhost:20128` |
| `MCP_LLM_API_KEY` | API key for that endpoint; leave blank for local servers that do not require auth |
| `MCP_RERANK_MODEL` | Chat model for LLM reranking, e.g. `llama3.1:8b`, `kr/claude-haiku-4.5`, `gpt-4o-mini` |
| `MCP_RERANK_BASE_URL` | Optional rerank-specific base URL; falls back to `MCP_LLM_BASE_URL` |
| `MCP_RERANK_API_KEY` | Optional rerank-specific API key; falls back to `MCP_LLM_API_KEY` |
| `RERANK_ENABLED` | Set `0` to disable reranking |
| `RERANK_TIMEOUT_MS` | Rerank request timeout; default `30000` |
| `MCP_EMBED_MODEL` | Embedding model for semantic recall, e.g. `nomic-embed-text`, `text-embedding-3-small`, `bm/baai/bge-m3` |
| `MCP_EMBED_BASE_URL` | Optional embedding-specific base URL; falls back to `MCP_LLM_BASE_URL` |
| `MCP_EMBED_API_KEY` | Optional embedding-specific API key; falls back to `MCP_LLM_API_KEY` |
| `EMBED_TIMEOUT_MS` | Embedding request timeout; default `15000` |
| `MCP_DETERMINISTIC_FALLBACK` | Hard no-network fallback when true; accepts `true`, `1`, `yes`, `on` |

Recall mode order:

1. `deterministic` if `MCP_DETERMINISTIC_FALLBACK=true`.
2. `semantic` if embeddings are configured and available.
3. `rerank` if a chat model is configured and enabled.
4. `keyword` offline fallback, always available.

Failures degrade gracefully. If your embedding endpoint returns `503`, recall falls back to rerank/keyword instead of failing the tool call.

## Provider strategy

The suite is provider-neutral. A practical remote setup is:

1. **Groq** for fast rerank/chat when model quality is sufficient.
2. **Cerebras** as a second fast provider for outages or model fit.
3. **OpenRouter** as broad fallback for many OpenAI-compatible models.

That chain is a deployment recommendation, not a built-in router in `v1.0.1`. Choose one endpoint in your MCP client env, or put LiteLLM/9Router/another gateway in front if you want automatic provider failover today.

Example OpenRouter-style config:

```bash
MCP_LLM_BASE_URL=https://openrouter.ai/api/v1
MCP_LLM_API_KEY=<your-key>
MCP_RERANK_MODEL=openai/gpt-4o-mini
```

Example local-only deterministic config:

```bash
MCP_DETERMINISTIC_FALLBACK=true
```

See [privacy and data flow](privacy.md) before using remote providers with sensitive projects.

## Legacy aliases

These older names still work for backward compatibility:

| Legacy | Preferred |
|---|---|
| `LLM_BASE_URL` | `MCP_LLM_BASE_URL` |
| `LLM_API_KEY` | `MCP_LLM_API_KEY` |
| `NINEROUTER_URL` | `MCP_LLM_BASE_URL` |
| `NINEROUTER_KEY` | `MCP_LLM_API_KEY` |
| `EMBED_MODEL` | `MCP_EMBED_MODEL` |
| `RERANK_MODEL` | `MCP_RERANK_MODEL` |
| `EMBED_URL` | `MCP_EMBED_BASE_URL` |
| `EMBED_KEY` | `MCP_EMBED_API_KEY` |
| `RERANK_URL` | `MCP_RERANK_BASE_URL` |
| `RERANK_KEY` | `MCP_RERANK_API_KEY` |

Prefer the `MCP_*` names for new installs.
