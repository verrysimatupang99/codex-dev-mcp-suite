import { deterministicEnabled } from "./env.js";

const DEFAULT_BASE = "http://localhost:20128";
const DEFAULT_MODEL = "kr/claude-haiku-4.5";

function value(name) {
  return String(process.env[name] || "").trim();
}

function providerEnv(prefix) {
  const label = value(prefix);
  const base = value(`${prefix}_BASE_URL`);
  const key = value(`${prefix}_API_KEY`);
  const model = value(`${prefix}_MODEL`);
  if (!label || !base || !key || !model) return null;
  return { label, base, key, model };
}

function numberedProviders() {
  const providers = [];
  const primary = providerEnv("MCP_PROVIDER_PRIMARY");
  if (primary) providers.push(primary);

  const slots = Object.keys(process.env)
    .map((name) => name.match(/^MCP_PROVIDER_CHAIN(\d+)$/)?.[1])
    .filter(Boolean)
    .map(Number)
    .filter((n) => n >= 2)
    .sort((a, b) => a - b);

  for (const n of slots) {
    const provider = providerEnv(`MCP_PROVIDER_CHAIN${n}`);
    if (provider) providers.push(provider);
  }
  return providers;
}

function legacyProvider() {
  const base = value("MCP_RERANK_BASE_URL") || value("MCP_LLM_BASE_URL") || value("LLM_BASE_URL") || value("RERANK_URL") || value("NINEROUTER_URL") || DEFAULT_BASE;
  const key = value("MCP_RERANK_API_KEY") || value("MCP_LLM_API_KEY") || value("LLM_API_KEY") || value("RERANK_KEY") || value("NINEROUTER_KEY");
  const model = value("MCP_RERANK_MODEL") || value("RERANK_MODEL") || DEFAULT_MODEL;
  if (!key) return null;
  return { label: "legacy", base, key, model };
}

export function providerChainConfig() {
  const deterministic = deterministicEnabled();
  const rerankEnabled = process.env.RERANK_ENABLED !== "0";
  if (deterministic || !rerankEnabled) return { providers: [], enabled: false, deterministic };
  const providers = numberedProviders();
  if (providers.length === 0) {
    const legacy = legacyProvider();
    if (legacy) providers.push(legacy);
  }
  return { providers, enabled: providers.length > 0, deterministic };
}
