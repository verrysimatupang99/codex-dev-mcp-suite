# Real-World Multi-Agent Vibe Coding Guide (`codex-dev-mcp-suite`)

This guide demonstrates how to combine **Antigravity**, **Hermes Agent**, **Claude Code**, **Cursor**, and **Codex CLI** into a zero-latency, context-synchronized AI team using `codex-dev-mcp-suite`.

---

## 🐝 1. Swarm Event Stream Workflow (`memory_broadcast`)

When multiple AI agents work on the same codebase simultaneously:

1. **Agent 1 (Hermes / Security Auditor)**:
   ```json
   {
     "name": "memory_broadcast",
     "arguments": {
       "topic": "SQL injection vulnerability",
       "eventType": "bug",
       "payload": { "file": "src/db/user.js", "line": 42 },
       "agentName": "Hermes-Security"
     }
   }
   ```

2. **Agent 2 (Antigravity / Lead Developer)**:
   Agent 2 queries the swarm timeline:
   ```json
   {
     "name": "memory_swarm_timeline",
     "arguments": { "limit": 10 }
   }
   ```
   *Output*: Immediately sees Agent 1's broadcast about line 42 in `src/db/user.js` and applies the fix without duplicate effort!

---

## 🛡️ 2. Safe Refactoring Workflow (`checkpoint` + `pack_impact`)

Before refactoring a high-risk file (e.g., `lib/auth.js`):

1. **Analyze Blast-Radius**:
   ```json
   {
     "name": "pack_impact",
     "arguments": { "targetFile": "lib/auth.js" }
   }
   ```

2. **Create Git-Independent Checkpoint**:
   ```json
   {
     "name": "checkpoint_create",
     "arguments": { "label": "before-auth-refactor" }
   }
   ```

3. **Predict Signature Impact**:
   ```json
   {
     "name": "pack_predictive_diff",
     "arguments": {
       "targetFile": "lib/auth.js",
       "proposedDiff": "export function verifyToken(jwt, secret) { ... }"
     }
   }
   ```

4. **Self-Healing Test Guard**:
   ```json
   {
     "name": "pack_guard",
     "arguments": { "checkType": "all" }
   }
   ```
   If tests fail, call `checkpoint_restore({ clean: true })` to revert in 1 second!

---

## 📜 3. Anti-Compaction Handoff (`journal_handoff`)

When a session nears model context limits:
1. Panggil `journal_handoff` dengan ringkasan langkah berikutnya.
2. Buka sesi baru di agent mana saja dan panggil `journal_resume` untuk melanjutkan pekerjaan tanpa kehilangan arah!
