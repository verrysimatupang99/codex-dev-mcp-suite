# Hermes Agent Setup

`codex-dev-mcp-suite` is fully compatible with **Hermes Agent** via the standard Model Context Protocol (MCP) stdio interface.

## Quick Installation

Ensure the package is installed globally or accessible via `npx`:

```bash
npm install -g codex-dev-mcp-suite
```

## Hermes Configuration (`~/.hermes/config.yaml`)

Add the suite servers to your Hermes `mcp_servers` configuration block in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  project-memory:
    command: project-memory-mcp
    args: []
    env:
      MEMORY_VAULT_DIR: "~/.local/share/dev-mcp-suite/memories/vault"
      MCP_LOCAL_EMBED: "true" # Enables zero-dependency local offline vector search

  devjournal:
    command: devjournal-mcp
    args: []
    env:
      JOURNAL_DIR: "~/.local/share/dev-mcp-suite/memories/journal"

  checkpoint:
    command: checkpoint-mcp
    args: []
    env:
      CHECKPOINT_DIR: "~/.local/share/dev-mcp-suite/memories/checkpoints"

  context-pack:
    command: context-pack-mcp
    args: []
```

## Features Available to Hermes

- **`memory_save` / `memory_recall`**: Persistent cross-session memory with optional local offline 384-d term-frequency hashing vector search (`MCP_LOCAL_EMBED=true`).
- **`journal_log` / `journal_resume` / `journal_handoff`**: Session log & handoff recovery.
- **`checkpoint_create` / `checkpoint_diff`**: File checkpoints independent of git.
- **`pack_overview` / `pack_tree` / `pack_audit`**: Codebase orientation & security risk auditing.
