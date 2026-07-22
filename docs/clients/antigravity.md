# Google Antigravity CLI (AGY CLI) Setup

`codex-dev-mcp-suite` connects seamlessly to **Google Antigravity CLI (AGY CLI)** and the AGY SDK agent framework.

## Quick Installation

```bash
npm install -g codex-dev-mcp-suite
```

## AGY Configuration (`mcp.json` / `settings.json`)

Add the suite to your AGY CLI settings or project `mcp.json`:

```json
{
  "mcpServers": {
    "project-memory": {
      "command": "project-memory-mcp",
      "args": [],
      "env": {
        "MEMORY_VAULT_DIR": "~/.local/share/dev-mcp-suite/memories/vault",
        "MCP_LOCAL_EMBED": "true"
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

## Client Compatibility Highlights

- **Stdio Isolation**: Zero stdout noise — all logs and diagnostic messages are routed exclusively to `stderr` or MCP log frames.
- **Offline Vector Engine**: Automatically uses the built-in 384-d term-frequency hashing vector when no remote embedding API key is set (`MCP_LOCAL_EMBED=true`).
- **Obsidian Graph Compatibility**: Compatible with `.obsidian` vault structure and `[[WikiLinks]]`.
