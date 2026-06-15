# Generic MCP Client Setup

Any MCP client that can start stdio servers can use Dev MCP Suite.

Install globally:

```bash
npm i -g codex-dev-mcp-suite
```

Generic server definitions:

```json
{
  "mcpServers": {
    "project-memory": {
      "command": "project-memory-mcp",
      "args": [],
      "env": {
        "MEMORY_VAULT_DIR": "~/.local/share/dev-mcp-suite/memories/vault"
      }
    },
    "devjournal": {
      "command": "devjournal-mcp",
      "args": [],
      "env": {
        "JOURNAL_DIR": "~/.local/share/dev-mcp-suite/memories/journal"
      }
    },
    "checkpoint": {
      "command": "checkpoint-mcp",
      "args": [],
      "env": {
        "CHECKPOINT_DIR": "~/.local/share/dev-mcp-suite/memories/checkpoints"
      }
    },
    "context-pack": {
      "command": "context-pack-mcp",
      "args": []
    }
  }
}
```

Optional model configuration can be added to `project-memory` and `devjournal` env blocks. See `docs/configuration.md`.
