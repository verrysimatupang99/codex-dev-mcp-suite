#!/usr/bin/env node
import { handleCliMeta } from "./_meta.mjs";
handleCliMeta({
  bin: "checkpoint-mcp",
  title: "Checkpoint MCP",
  usesModel: false,
  storage: [["store", "CHECKPOINT_DIR"]],
});
import("../checkpoint/server.js");
