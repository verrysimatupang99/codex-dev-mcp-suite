#!/usr/bin/env node
import { handleCliMeta } from "./_meta.mjs";
handleCliMeta({
  bin: "project-memory-mcp",
  title: "Project Memory MCP",
  usesModel: true,
  storage: [["vault", "MEMORY_VAULT_DIR"]],
});
const { ProjectMemoryServer } = await import("../project-memory/server.js");
new ProjectMemoryServer().run().catch(console.error);
