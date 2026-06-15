#!/usr/bin/env node
import { handleCliMeta } from "./_meta.mjs";
handleCliMeta({
  bin: "project-memory-mcp",
  title: "Project Memory MCP",
  usesModel: true,
  storage: [["vault", "MEMORY_VAULT_DIR"]],
});
import("../project-memory/server.js");
