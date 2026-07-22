/**
 * Auto-Config Installer Wizard for codex-dev-mcp-suite.
 * Detects installed AI tools (Codex, Claude Code, Cursor, Windsurf, Hermes, AGY)
 * and configures the 4 MCP servers automatically.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";

const HOME = os.homedir();

export const CLIENT_CONFIGS = [
  {
    name: "Codex CLI",
    type: "toml",
    path: path.join(HOME, ".codex", "config.toml"),
    sampleSnippet: `
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
`
  },
  {
    name: "Claude Code",
    type: "json",
    path: path.join(HOME, ".claude.json"),
  },
  {
    name: "Cursor",
    type: "json",
    path: path.join(HOME, ".cursor", "mcp.json"),
  },
  {
    name: "Windsurf",
    type: "json",
    path: path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
  },
  {
    name: "Hermes Agent",
    type: "json",
    path: path.join(HOME, ".hermes", "config.json"),
  },
  {
    name: "Antigravity CLI",
    type: "json",
    path: path.join(HOME, ".gemini", "antigravity-cli", "mcp_servers.json"),
  }
];

export async function detectClients() {
  const detected = [];
  for (const client of CLIENT_CONFIGS) {
    try {
      await fs.access(path.dirname(client.path));
      detected.push(client);
    } catch {}
  }
  return detected;
}

export async function configureJsonClient(configPath) {
  let json = {};
  try {
    const raw = await fs.readFile(configPath, "utf8");
    json = JSON.parse(raw);
  } catch {}

  json.mcpServers = json.mcpServers || {};
  const servers = ["project-memory", "devjournal", "checkpoint", "context-pack"];
  for (const s of servers) {
    json.mcpServers[s] = {
      command: "npx",
      args: ["-y", "-p", "codex-dev-mcp-suite", `${s}-mcp`]
    };
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(json, null, 2) + "\n");
  return configPath;
}

export async function runInitWizard({ dryRun = false } = {}) {
  const clients = await detectClients();
  const results = [];

  for (const c of clients) {
    if (c.type === "json") {
      if (!dryRun) {
        await configureJsonClient(c.path);
      }
      results.push({ name: c.name, path: c.path, status: dryRun ? "PREVIEW" : "CONFIGURED 🟢" });
    } else if (c.type === "toml") {
      let content = "";
      try {
        content = await fs.readFile(c.path, "utf8");
      } catch {}

      if (!content.includes("[mcp_servers.project-memory]") && !dryRun) {
        await fs.mkdir(path.dirname(c.path), { recursive: true });
        await fs.appendFile(c.path, "\n" + c.sampleSnippet.trim() + "\n");
      }
      results.push({ name: c.name, path: c.path, status: dryRun ? "PREVIEW" : "CONFIGURED 🟢" });
    }
  }

  return { detectedCount: clients.length, results };
}
