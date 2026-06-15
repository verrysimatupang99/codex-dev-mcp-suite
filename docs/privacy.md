# Privacy and Data Flow

Dev MCP Suite is local-first. It has no hosted backend, no built-in telemetry, and no account system owned by this project.

## What is stored locally

| Server | Local data |
|---|---|
| `project-memory` | Markdown notes, keyword index, optional embedding vectors if you run `memory_reindex` with embeddings configured |
| `devjournal` | Session logs, handoff files, timeline entries |
| `checkpoint` | Text-file snapshots for rollback |
| `context-pack` | No persistent project data by default |

Default storage paths are under `~/.codex/memories/...`; you can override them with `MEMORY_VAULT_DIR`, `JOURNAL_DIR`, and `CHECKPOINT_DIR`.

## What can leave your machine

Nothing leaves your machine by default. `project-memory` and `devjournal` use offline keyword scoring unless you configure an external OpenAI-compatible model endpoint.

If you set model environment variables such as `MCP_LLM_BASE_URL`, `MCP_EMBED_BASE_URL`, `MCP_RERANK_BASE_URL`, or numbered provider slots like `MCP_PROVIDER_PRIMARY_BASE_URL`, the related query text and candidate snippets may be sent to that endpoint for embeddings or reranking. The endpoint can be local (Ollama, LM Studio, vLLM, LiteLLM) or remote (Groq, Cerebras, OpenRouter, 9Router, OpenAI-compatible gateways).

## Hard no-network mode

Set this when you want deterministic local-only recall even if model keys are present:

```bash
MCP_DETERMINISTIC_FALLBACK=true
```

Accepted true values: `true`, `1`, `yes`, `on` (case-insensitive). In this mode:

- Embeddings are disabled.
- LLM reranking is disabled.
- `memory_reindex` skips embedding generation.
- Results are labeled `[deterministic]`.

## Recommended provider posture

For remote providers, use least-privilege API keys and configure them per MCP client environment. Do not commit API keys to this repository or project repos. Prefer local models for sensitive work; use remote providers only for projects where sending snippets to that provider is acceptable.
