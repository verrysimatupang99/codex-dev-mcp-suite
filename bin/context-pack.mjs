#!/usr/bin/env node
import { handleCliMeta } from "./_meta.mjs";
handleCliMeta({
  bin: "context-pack-mcp",
  title: "Context Pack MCP",
  usesModel: false,
  storage: [],
});
import("../context-pack/server.js");
