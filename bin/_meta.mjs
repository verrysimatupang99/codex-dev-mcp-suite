import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkForUpdates } from "../lib/update-check.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function pkgVersion() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8");
    return JSON.parse(raw).version || "unknown";
  } catch { return "unknown"; }
}

function redactKey(name) {
  const v = String(process.env[name] || "");
  return v ? `set (${v.length} chars)` : "not set";
}

function doctorLines(meta) {
  const lines = [];
  lines.push(`${meta.title} doctor`);
  lines.push(`version: ${pkgVersion()}`);
  lines.push(`node: ${process.version}`);
  for (const [label, name] of meta.storage || []) {
    lines.push(`${label}: ${process.env[name] || meta.storageDefaults?.[name] || "(default)"}`);
  }
  const det = /^(1|true|yes|on)$/i.test(String(process.env.MCP_DETERMINISTIC_FALLBACK || "").trim());
  lines.push(`deterministic no-network: ${det ? "on" : "off"}`);
  if (meta.usesModel) {
    lines.push("model/provider config (keys redacted):");
    lines.push(`  MCP_LLM_BASE_URL: ${process.env.MCP_LLM_BASE_URL || "(unset)"}`);
    lines.push(`  MCP_LLM_API_KEY: ${redactKey("MCP_LLM_API_KEY")}`);
    lines.push(`  MCP_PROVIDER_PRIMARY: ${process.env.MCP_PROVIDER_PRIMARY || "(unset)"}`);
    lines.push(`  MCP_PROVIDER_PRIMARY_API_KEY: ${redactKey("MCP_PROVIDER_PRIMARY_API_KEY")}`);
    lines.push(`  MCP_EMBED_API_KEY: ${redactKey("MCP_EMBED_API_KEY")}`);
    lines.push(`  MCP_RERANK_API_KEY: ${redactKey("MCP_RERANK_API_KEY")}`);
  } else {
    lines.push("model/provider config: not used by this server");
  }
  return lines;
}

export function handleCliMeta(meta) {
  // Non-blocking update check on startup (cached 24h, logged to stderr)
  checkForUpdates().catch(() => {});

  const argv = process.argv.slice(2);
  if (argv.includes("-v") || argv.includes("--version")) {
    process.stdout.write(`${pkgVersion()}\n`);
    process.exit(0);
  }
  if (argv.includes("-h") || argv.includes("--help")) {
    const out = [
      `${meta.title} (${meta.bin}) v${pkgVersion()}`,
      "",
      "An MCP server that speaks JSON-RPC over stdio. Launch it from an MCP client.",
      "",
      "Usage:",
      `  ${meta.bin}            start the MCP stdio server`,
      `  ${meta.bin} --version  print version`,
      `  ${meta.bin} --doctor   print config diagnostics (API keys redacted)`,
      `  ${meta.bin} --help     show this help`,
    ];
    process.stdout.write(out.join("\n") + "\n");
    process.exit(0);
  }
  if (argv.includes("--doctor")) {
    process.stdout.write(doctorLines(meta).join("\n") + "\n");
    process.exit(0);
  }
  return false;
}
