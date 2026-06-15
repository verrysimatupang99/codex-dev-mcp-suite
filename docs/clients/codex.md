# Codex CLI Setup

Install globally:

```bash
npm i -g codex-dev-mcp-suite
```

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.project-memory]
command = "project-memory-mcp"
[mcp_servers.project-memory.env]
MEMORY_VAULT_DIR = "~/.codex/memories/vault"
# Optional model features; omit for offline keyword mode.
MCP_LLM_BASE_URL = "http://localhost:20128"
MCP_LLM_API_KEY = "sk-..."
MCP_RERANK_MODEL = "kr/claude-haiku-4.5"
MCP_EMBED_MODEL = "bm/baai/bge-m3"

[mcp_servers.devjournal]
command = "devjournal-mcp"
[mcp_servers.devjournal.env]
JOURNAL_DIR = "~/.codex/memories/journal"
MCP_LLM_BASE_URL = "http://localhost:20128"
MCP_LLM_API_KEY = "sk-..."
MCP_RERANK_MODEL = "kr/claude-haiku-4.5"

[mcp_servers.checkpoint]
command = "checkpoint-mcp"
[mcp_servers.checkpoint.env]
CHECKPOINT_DIR = "~/.codex/memories/checkpoints"

[mcp_servers.context-pack]
command = "context-pack-mcp"
```

Important: the server name is `project-memory` with a hyphen. `project_memory` is not a configured MCP server name in Codex.
