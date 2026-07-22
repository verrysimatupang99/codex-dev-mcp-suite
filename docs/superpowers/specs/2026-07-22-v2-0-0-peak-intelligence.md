# Design Spec: v2.0.0 — Peak Intelligence Edition

## Overview

`codex-dev-mcp-suite` v2.0.0 elevates AI coding agents (Codex CLI, Hermes Agent, Antigravity, Claude Code, Cursor) to peak developer intelligence. It bridges human intent, deep codebase dependency structure, self-healing diagnostic feedback, multi-agent collaboration, and token compression.

---

## 🚀 4 Core Pillars

### 1. Codebase Dependency Blast-Radius (`pack_graph` & `pack_impact`)
- **Module**: `context-pack`
- **Goal**: Parse imports/exports across JS/TS/JSX/TSX/Python files to build an in-memory dependency graph.
- **Tool**: `pack_impact({ targetFile, depth })`
- **Output**:
  - `importers`: List of files that import the target file.
  - `imported`: List of files imported by the target file.
  - `impactScore`: Calculated risk score (1-10) based on fan-out depth.

### 2. Self-Healing Diagnostic Pre-flight (`pack_guard`)
- **Module**: `context-pack`
- **Goal**: Auto-detect project build/test toolchain (`npm test`, `tsc --noEmit`, `eslint`, `pytest`, `cargo check`) and execute pre-flight diagnostics safely.
- **Tool**: `pack_guard({ checkType: "all" | "typecheck" | "test" | "lint" })`
- **Output**: Structured JSON array of diagnostic findings:
  - `[{ severity: "error"|"warning", file, line, column, message, rule }]`

### 3. Multi-Agent Memory Stream (`memory_swarm`)
- **Module**: `project-memory`
- **Goal**: Enable real-time cross-agent memory broadcasting and event streams across active subagents (Antigravity, Hermes, Codex, Claude Code) working in the same workspace.
- **Tools**: `memory_broadcast({ eventType, data })`, `memory_timeline()`

### 4. Session Context Compression & Time Machine (`journal_compress`)
- **Module**: `devjournal`
- **Goal**: Summarize 50+ turns of verbose session logs into a 500-token compact snapshot to prevent context window bloat and reduce LLM token cost by ~90%.
- **Tool**: `journal_compress({ projectSlug, maxTokens })`

---

## 🛠️ Implementation Plan

### Phase 1: `pack_guard` & `pack_graph` (Core Diagnostics & Impact Analysis)
1. Add AST import parser & dependency map to `context-pack/server.js`.
2. Add `pack_impact` tool declaration and execution handler.
3. Add `pack_guard` tool declaration and toolchain runner with timeout safety.
4. Add unit test assertions in `context-pack/test.mjs`.

### Phase 2: `memory_swarm` & `journal_compress`
1. Add event broadcast stream in `project-memory/server.js`.
2. Add session log token compressor in `devjournal/server.js`.
3. Add unit tests for swarm & compression.
