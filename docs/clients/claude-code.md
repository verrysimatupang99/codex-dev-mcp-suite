# Claude Code Setup

Install globally:

```bash
npm i -g codex-dev-mcp-suite
```

Add MCP servers using your Claude Code MCP configuration flow. Generic JSON shape:

```json
{
  "mcpServers": {
    "project-memory": {
      "command": "project-memory-mcp",
      "env": {
        "MEMORY_VAULT_DIR": "~/.local/share/dev-mcp-suite/memories/vault",
        "MCP_LLM_BASE_URL": "http://localhost:11434/v1",
        "MCP_LLM_API_KEY": "",
        "MCP_RERANK_MODEL": "llama3.1:8b",
        "MCP_EMBED_MODEL": "nomic-embed-text"
      }
    },
    "devjournal": {
      "command": "devjournal-mcp",
      "env": {
        "JOURNAL_DIR": "~/.local/share/dev-mcp-suite/memories/journal",
        "MCP_LLM_BASE_URL": "http://localhost:11434/v1",
        "MCP_LLM_API_KEY": "",
        "MCP_RERANK_MODEL": "llama3.1:8b"
      }
    },
    "checkpoint": {
      "command": "checkpoint-mcp",
      "env": {
        "CHECKPOINT_DIR": "~/.local/share/dev-mcp-suite/memories/checkpoints"
      }
    },
    "context-pack": {
      "command": "context-pack-mcp"
    }
  }
}
```

If you do not configure model env vars, `memory_recall` and `journal_search` still work in offline keyword mode.
