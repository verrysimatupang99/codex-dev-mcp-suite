#!/usr/bin/env node
import { handleCliMeta } from "./_meta.mjs";
handleCliMeta({
  bin: "armada-mcp",
  title: "Armada Fleet MCP",
  usesModel: false,
  storage: [
    ["bus url", "ARMADA_BUS_URL"],
    ["bus token", "ARMADA_BUS_TOKEN"],
  ],
});
import("../armada/server.js");
