# Dev MCP Suite 🚀

> **Give your AI Coding Assistant Permanent Brain Power & Zero Memory Loss.**

[![CI](https://github.com/verrysimatupang99/codex-dev-mcp-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/verrysimatupang99/codex-dev-mcp-suite/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-dev-mcp-suite.svg)](https://www.npmjs.com/package/codex-dev-mcp-suite)
[![npm downloads](https://img.shields.io/npm/dm/codex-dev-mcp-suite.svg)](https://www.npmjs.com/package/codex-dev-mcp-suite)
[![license](https://img.shields.io/npm/l/codex-dev-mcp-suite.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/codex-dev-mcp-suite.svg)](https://nodejs.org)
[![Saweria](https://img.shields.io/badge/Saweria-Dukung%20Proyek-FAAE2B?style=flat&logo=saweria&logoColor=black)](https://saweria.co/sijuling)

Published on npm as `codex-dev-mcp-suite`.

---

### 😩 Sound Familiar?

> *"You spent 45 minutes explaining your database schema and architecture to your AI agent. Then... **'Context window compacted'** or session restarted. Boom. Your AI forgot everything and started hallucinating variable names."*

**Stop re-pasting context over and over.** 

**Dev MCP Suite** is a suite of four local, zero-telemetry MCP (Model Context Protocol) servers built for solo developers and vibe coders. It equips your favorite AI agent (**Codex CLI, Hermes Agent, Google Antigravity, Claude Code, Cursor, Windsurf**) with permanent memory, anti-compaction handoffs, git-safe checkpoints, and offline vector search.

---

### ⚡ Before & After Dev MCP Suite

| Without Dev MCP Suite 🥱 | With Dev MCP Suite ⚡ |
|---|---|
| Re-explaining project setup every time session resets | One-command `journal_resume` recovers context instantly |
| AI forgets architectural decisions and preferences | Obsidian-compatible Markdown vault retains knowledge permanently |
| Wasted git commits just to save temporary experiments | Git-independent `checkpoint_create` & instant rollback |
| Accidental secret/API key leaks committed to GitHub | Built-in `pack_audit` flags missing `.gitignore` & leaked keys |
| Locked into a proprietary hosted backend | 100% Local-first, zero cloud lock-in, zero telemetry |

---

### ⚡ 10-Second Quickstart

Try it right now without cloning or installing:

```bash
npx -y -p codex-dev-mcp-suite project-memory-mcp --help
```

---

### 🛠️ The 4 Superpowers (MCP Servers)

| Server | Superpower | Key Tools |
|---|---|---|
| 🧠 **`project-memory`** | **Obsidian-Grade Knowledge Vault**: Persistent Markdown notes, wiki-links (`[[note]]`), MOC generation, and zero-dependency local 384-d vector search (`MCP_LOCAL_EMBED=true`). | `memory_save`, `memory_recall`, `memory_list`, `memory_get`, `memory_link`, `memory_moc`, `memory_graph`, `memory_dedup` |
| 📜 **`devjournal`** | **Anti-Compaction Session Timeline**: Logs progress, saves handoffs, and restores full context when sessions compact or restart. | `journal_log`, `journal_handoff`, `journal_resume`, `journal_timeline`, `journal_search`, `journal_clear_handoff` |
| 🛡️ **`checkpoint`** | **Git-Independent Snapshots**: Take 1-second file snapshots before risky AI refactors. Compare diffs and revert instantly without touching your git tree. | `checkpoint_create`, `checkpoint_list`, `checkpoint_diff`, `checkpoint_restore`, `checkpoint_delete` |
| 🔍 **`context-pack`** | **Codebase Orientation & Security Audit**: Token-efficient project briefings (stack, symbols, tree) plus instant security auditing to catch leaked secrets. | `pack_overview`, `pack_tree`, `pack_outline`, `pack_search`, `pack_audit` |

---

### 🧠 Intelligent Local-First Semantic Search

`memory_recall` automatically selects the best available search engine on your machine:

1. **Local Offline Vector Search (`v1.8.0`)** — Set `MCP_LOCAL_EMBED=true` to use the built-in, zero-dependency 384-dimensional term-frequency hashing vector engine. Sub-millisecond execution, zero network requests, 100% private.
2. **Remote Embeddings (Optional)** — Connect any OpenAI-compatible `/v1/embeddings` endpoint (OpenAI, Cloudflare Workers AI, Ollama, LM Studio, 9router, OpenRouter).
3. **LLM Reranking (Optional)** — Hybrid keyword pre-filter followed by LLM reranking for high-precision recall.
4. **Keyword Fallback** — Always-available offline fallback if no network or API keys exist.

---

### 🔌 Plug & Play with Any MCP Client

#### 1. Codex CLI (`~/.codex/config.toml`)
```toml
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

#### 2. Hermes Agent (`~/.hermes/config.yaml`)
```yaml
mcp_servers:
  project-memory:
    command: project-memory-mcp
    env:
      MCP_LOCAL_EMBED: "true"
  devjournal:
    command: devjournal-mcp
  checkpoint:
    command: checkpoint-mcp
  context-pack:
    command: context-pack-mcp
```

#### 3. Google Antigravity CLI / Cursor / Claude Code (`mcp.json`)
```json
{
  "mcpServers": {
    "project-memory": { "command": "project-memory-mcp", "env": { "MCP_LOCAL_EMBED": "true" } },
    "devjournal": { "command": "devjournal-mcp" },
    "checkpoint": { "command": "checkpoint-mcp" },
    "context-pack": { "command": "context-pack-mcp" }
  }
}
```

👉 See detailed client setup guides in [`docs/clients/`](docs/clients/).

---

### 🚀 Daily Solo Developer Workflow

- **Session Start**: Run `pack_overview` + `journal_resume` + `memory_recall "<topic>"` to get oriented in seconds.
- **Before Risky Changes**: Run `checkpoint_create` to create a safe recovery point.
- **While Coding**: Run `memory_save` to store architectural decisions, and `pack_audit` before committing.
- **Session End / Compaction**: Run `journal_handoff` so your next session picks up right where you left off.

---

### 📊 Utility CLIs Included

Install globally with `npm i -g codex-dev-mcp-suite` to access built-in maintenance tools:

- `stats` — View total notes, journal activity, and storage stats across all projects (`stats --json`).
- `prune` — Safely clean up temporary project scratch files (`prune --yes`).
- `provider-smoke` — Probe configured LLM providers (chat & embedding endpoints) for health and latency.

---

### 🔒 Privacy & Local-First Philosophy

- **Zero Cloud Backend**: Everything is saved locally as plain Markdown & JSON files on your hard drive (`~/.ai-shared-memory` or project directory).
- **Zero Telemetry**: No tracking, no user accounts, no phoning home.
- **Network Isolation Ready**: Set `MCP_DETERMINISTIC_FALLBACK=true` for 100% air-gapped, offline operations.
- See detailed [privacy and data flow documentation](docs/privacy.md).

---

### ☕ Support / Donasi

Jika `codex-dev-mcp-suite` membantu alur kerja pengkodean Anda dan menghemat waktu Anda, dukung pengembangan proyek open-source ini melalui Saweria (QRIS, GoPay, DANA, OVO, ShopeePay):

[![Saweria](https://img.shields.io/badge/Saweria-Dukung%20Proyek-FAAE2B?style=for-the-badge&logo=saweria&logoColor=black)](https://saweria.co/sijuling)

---

### 📄 License

MIT © Verry Simatupang — see [LICENSE](./LICENSE).
