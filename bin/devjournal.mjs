#!/usr/bin/env node
import { handleCliMeta } from "./_meta.mjs";
handleCliMeta({
  bin: "devjournal-mcp",
  title: "Dev Journal MCP",
  usesModel: true,
  storage: [["store", "JOURNAL_DIR"]],
});
import("../devjournal/server.js");
