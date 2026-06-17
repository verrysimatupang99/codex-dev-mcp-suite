# Dev MCP Suite

[![CI](https://github.com/verrysimatupang99/codex-dev-mcp-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/verrysimatupang99/codex-dev-mcp-suite/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-dev-mcp-suite.svg)](https://www.npmjs.com/package/codex-dev-mcp-suite)
[![npm downloads](https://img.shields.io/npm/dm/codex-dev-mcp-suite.svg)](https://www.npmjs.com/package/codex-dev-mcp-suite)
[![license](https://img.shields.io/npm/l/codex-dev-mcp-suite.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/codex-dev-mcp-suite.svg)](https://nodejs.org)

Published as `codex-dev-mcp-suite` for backward compatibility.

Four local, file-based MCP servers for solo developers and vibecoders who keep
losing context when sessions hit "input too long" / get compacted / restart.
Stop re-pasting context across sessions.

All servers are **local, dependency-light (only the MCP SDK), and split storage
per-project** by the working directory. Works with any MCP-capable client
(Codex CLI, Claude Code, Cursor, Cline, Gemini-compatible launchers, Hermes,
or any stdio MCP host).

## Quickstart

Try it in 10 seconds (no clone, no config):

```bash
npx -y -p codex-dev-mcp-suite project-memory-mcp --help
```

Local-first by default: no hosted backend, no telemetry. Works offline with
keyword recall; model/provider config is optional. For strict no-network mode,
set `MCP_DETERMINISTIC_FALLBACK=true`.

Register all four servers with an MCP client (Codex CLI shown):

```toml
# ~/.codex/config.toml
[mcp_servers.project-memory]
command = "npx"
args = ["-y", "-p", "codex-dev-mcp-suite", "project-memory-mcp"]

[mcp_servers.devjournal]
command = "npx"
args = ["-y", "-p", "codex-dev-mcp-suite", "devjournal-mcp"]

[mcp_servers.checkpoint]
command = "npx"
args = ["-y", "-p", "codex-dev-mcp-suite", "checkpoint-mcp"]

[mcp_servers.context-pack]
command = "npx"
args = ["-y", "-p", "codex-dev-mcp-suite", "context-pack-mcp"]
```

Inspect any server without starting it:

```bash
project-memory-mcp --version
project-memory-mcp --doctor   # config diagnostics; API keys redacted
```

Other clients (Claude Code, Cursor, Cline, ...): see
[`docs/clients/`](docs/clients/). Full env reference:
[`docs/configuration.md`](docs/configuration.md). Data flow:
[`docs/privacy.md`](docs/privacy.md).

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
Use the neutral `MCP_*` environment variables for new installs; legacy
`NINEROUTER_*` and `LLM_*` variables are still supported. See
[`docs/configuration.md`](docs/configuration.md).

Need hard local-only behavior? Set `MCP_DETERMINISTIC_FALLBACK=true` to disable
embeddings/rerank even if model keys are present; results are labeled
`[deterministic]`.

## Install

Requires Node.js >= 18.

### Quickest: run via npx (no clone)

Point your MCP client at the published package — no install step needed:

```toml
# Codex CLI ~/.codex/config.toml
[mcp_servers.project-memory]
command = "npx"
args = ["-y", "-p", "codex-dev-mcp-suite", "project-memory-mcp"]

[mcp_servers.devjournal]
command = "npx"
args = ["-y", "-p", "codex-dev-mcp-suite", "devjournal-mcp"]

[mcp_servers.checkpoint]
command = "npx"
args = ["-y", "-p", "codex-dev-mcp-suite", "checkpoint-mcp"]

[mcp_servers.context-pack]
command = "npx"
args = ["-y", "-p", "codex-dev-mcp-suite", "context-pack-mcp"]
```

Or install globally: `npm i -g codex-dev-mcp-suite` → commands
`project-memory-mcp`, `devjournal-mcp`, `checkpoint-mcp`, `context-pack-mcp`.

### From source

```bash
git clone https://github.com/<you>/codex-dev-mcp-suite.git
cd codex-dev-mcp-suite
# install the MCP SDK in each server
for s in project-memory checkpoint context-pack devjournal; do (cd "$s" && npm install); done
```

### Register with your MCP client

Client-specific examples:

- [Codex CLI](docs/clients/codex.md)
- [Claude Code](docs/clients/claude-code.md)
- [Generic MCP JSON](docs/clients/generic-mcp.md)

**Codex CLI** (`~/.codex/config.toml`):

```toml
[mcp_servers.project-memory]
command = "node"
args = ["/abs/path/codex-dev-mcp-suite/project-memory/server.js"]
[mcp_servers.project-memory.env]
MEMORY_VAULT_DIR = "~/.codex/memories/vault"
# optional recall upgrades (see .env.example and docs/configuration.md)
# MCP_LLM_BASE_URL = "http://localhost:11434/v1"   # any OpenAI-compatible endpoint
# MCP_LLM_API_KEY = "..."
# MCP_RERANK_MODEL = "llama3.1:8b"

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

**Claude Code / Cursor / Cline / other MCP clients** (`mcpServers` JSON): same
idea — use the npm bin commands (`project-memory-mcp`, `devjournal-mcp`,
`checkpoint-mcp`, `context-pack-mcp`) or `node /abs/path/<server>/server.js`,
with optional `env`.

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

## Stats CLI

A read-only summary of your local memory storage — totals, top projects,
recent activity, and temp-slug cleanup candidates.

```bash
npx -y -p codex-dev-mcp-suite stats             # human-readable
npx -y -p codex-dev-mcp-suite stats --json      # machine-readable
npx -y -p codex-dev-mcp-suite stats --root /tmp/mem   # different root
npx -y -p codex-dev-mcp-suite stats --top 5     # trim top lists
```

Example output:

```
Dev MCP Suite — stats
======================
Storage root: /home/you/.codex/memories

Totals
------
  Notes:           89
  Journal projects:19
  Checkpoints:     1
  Distinct projects: 25

Top projects by notes (top 10)
------------------------
    24  mrtrickster99-fd1ff0fa
    14  Coding-17e063ef
    ...

Temp/cleanup candidates (2)
------------------------
  tmp.itbtDn9eB3-b62798fd
  tmp.iHqM2Uh5K2-8d3660a2
```

The CLI is a thin wrapper around `lib/stats.js`, which is also importable
directly from your own scripts. The default storage root is
`~/.codex/memories`, but `--root` (or the existing `MEMORY_VAULT_DIR` /
`JOURNAL_DIR` / `CHECKPOINT_DIR` env vars) override it.


## Prune CLI

Remove temp project slugs (prefix `tmp.`) from vault / journal / checkpoints.
Default is DRY-RUN — nothing is deleted without `--yes`.

```bash
npx -y -p codex-dev-mcp-suite prune           # dry-run report
npx -y -p codex-dev-mcp-suite prune --yes     # actually delete
npx -y -p codex-dev-mcp-suite prune --json    # machine-readable
npx -y -p codex-dev-mcp-suite prune --root /tmp/mem   # different root
```

Safety: refuses to delete any slug that does not start with `tmp.`. Useful
right after heavy refactors or after imports that left tmp scratch dirs.

For in-session use from an MCP client, the project-memory server exposes a
`memory_stats` tool that returns the same summary text (or JSON) as the `stats`
CLI above.

## Tests

```bash
node run-tests.mjs          # all servers (offline, ~27 tests)
cd project-memory && npm test
```

## Privacy

Local-first by default: no hosted backend, no built-in telemetry, no project
account system. Everything is stored as files on your machine. No data leaves
your machine unless you explicitly configure an external model/API endpoint for
rerank or embeddings. See [privacy and data flow](docs/privacy.md). Your
personal vault/journal/checkpoints are gitignored.

## License

MIT — see [LICENSE](./LICENSE).
