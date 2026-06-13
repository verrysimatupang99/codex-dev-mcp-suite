# Codex Dev MCP Suite

Four local, file-based MCP servers for solo developers and vibecoders who keep
losing context when sessions hit "input too long" / get compacted / restart.
Stop re-pasting context across sessions.

All servers are **local, dependency-light (only the MCP SDK), and split storage
per-project** by the working directory. Works with any MCP-capable client
(Codex CLI, Claude Code, Cursor, Cline, etc.).

## The four servers

| Server | What it does | Key tools |
|---|---|---|
| **project-memory** | Searchable Markdown knowledge vault (Obsidian-style notes + on-demand recall). Notes are also exposed as MCP resources. | `memory_save`, `memory_recall`, `memory_list`, `memory_get`, `memory_delete`, `memory_reindex` |
| **devjournal** | Per-project session timeline + handoff/resume (anti-compaction). | `journal_log`, `journal_handoff`, `journal_resume`, `journal_timeline`, `journal_search`, `journal_clear_handoff` |
| **checkpoint** | Git-independent file snapshots for safe experimentation. | `checkpoint_create`, `checkpoint_list`, `checkpoint_diff`, `checkpoint_restore`, `checkpoint_delete` |
| **context-pack** | Token-efficient project briefing (stack, tree, symbols, search). | `pack_overview`, `pack_tree`, `pack_outline`, `pack_search` |

## Recall quality (project-memory & devjournal)

Recall auto-selects the best available mode:

1. **semantic** — if an embeddings endpoint is configured (any OpenAI-compatible `/v1/embeddings`: OpenAI, Ollama, LM Studio, OpenRouter, vLLM, LiteLLM, 9router, ...)
2. **rerank** — keyword prefilter then an LLM reranker (any OpenAI-compatible chat model)
3. **keyword** — always-available offline fallback

All network features degrade gracefully: no endpoint = keyword mode, never an error.

## Install

Requires Node.js >= 18.

```bash
git clone https://github.com/<you>/codex-dev-mcp-suite.git
cd codex-dev-mcp-suite
# install the MCP SDK in each server
for s in project-memory checkpoint context-pack devjournal; do (cd "$s" && npm install); done
```

### Register with your MCP client

**Codex CLI** (`~/.codex/config.toml`):

```toml
[mcp_servers.project-memory]
command = "node"
args = ["/abs/path/codex-dev-mcp-suite/project-memory/server.js"]
[mcp_servers.project-memory.env]
MEMORY_VAULT_DIR = "~/.codex/memories/vault"
# optional recall upgrades (see .env.example)
# LLM_BASE_URL = "http://localhost:11434/v1"   # any OpenAI-compatible endpoint
# LLM_API_KEY = "..."
# RERANK_MODEL = "llama3.1:8b"

[mcp_servers.checkpoint]
command = "node"
args = ["/abs/path/codex-dev-mcp-suite/checkpoint/server.js"]

[mcp_servers.context-pack]
command = "node"
args = ["/abs/path/codex-dev-mcp-suite/context-pack/server.js"]

[mcp_servers.devjournal]
command = "node"
args = ["/abs/path/codex-dev-mcp-suite/devjournal/server.js"]
[mcp_servers.devjournal.env]
JOURNAL_DIR = "~/.codex/memories/journal"
```

**Claude Code / Cursor / Cline** (`mcpServers` JSON): same idea — `command: "node"`,
`args: ["/abs/path/<server>/server.js"]`, optional `env`.

## Daily workflow

- Session start: `pack_overview` + `journal_resume` + `memory_recall "<topic>"`
- Before a risky change: `checkpoint_create`
- While working: `memory_save` (durable facts), `journal_log` (events/blockers)
- Session end / before compaction: `journal_handoff`

## Optional: import your existing Codex history

`backfill-sessions-v2.mjs` reads `~/.codex/sessions/*.jsonl` and imports each
session (prompts, plan, commands, files touched) into project-memory + devjournal,
grouped by project, backdated to the original session time.

```bash
node backfill-sessions-v2.mjs --dry --min-prompts 2     # preview
node backfill-sessions-v2.mjs --min-prompts 2           # import
```

## Tests

```bash
node run-tests.mjs          # all servers (offline, ~27 tests)
cd project-memory && npm test
```

## Privacy

Everything is stored as plain files on your machine. No data leaves your
computer unless you explicitly configure an embeddings/rerank endpoint. Your
personal vault/journal/checkpoints are gitignored.

## License

MIT — see [LICENSE](./LICENSE).
