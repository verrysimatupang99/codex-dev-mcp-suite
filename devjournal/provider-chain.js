import { deterministicEnabled } from "./env.js";

const DEFAULT_BASE = "http://localhost:20128";
const DEFAULT_MODEL = "kr/claude-haiku-4.5";

function value(name) {
  return String(process.env[name] || "").trim();
}

export function redactKey(key) {
  const k = String(key || "");
  return k ? `set (${k.length} chars)` : "not set";
}

function providerEnv(prefix) {
  const label = value(prefix);
  const base = value(`${prefix}_BASE_URL`);
  const key = value(`${prefix}_API_KEY`);
  const model = value(`${prefix}_MODEL`);
  if (!label || !base || !key || !model) return null;
  return { label, base, key, model };
}

function slotIssues(prefix) {
  const present = ["", "_BASE_URL", "_API_KEY", "_MODEL"].some((s) => value(`${prefix}${s}`));
  if (!present) return null;
  const missing = [];
  if (!value(prefix)) missing.push(`${prefix}`);
  if (!value(`${prefix}_BASE_URL`)) missing.push(`${prefix}_BASE_URL`);
  if (!value(`${prefix}_API_KEY`)) missing.push(`${prefix}_API_KEY`);
  if (!value(`${prefix}_MODEL`)) missing.push(`${prefix}_MODEL`);
  return missing.length ? { prefix, missing } : null;
}

function numberedPrefixes() {
  const prefixes = ["MCP_PROVIDER_PRIMARY"];
  const nums = Object.keys(process.env)
    .map((name) => name.match(/^MCP_PROVIDER_CHAIN(\d+)/)?.[1])
    .filter(Boolean)
    .map(Number)
    .filter((n) => n >= 2);
  for (const n of [...new Set(nums)].sort((a, b) => a - b)) {
    prefixes.push(`MCP_PROVIDER_CHAIN${n}`);
  }
  return prefixes;
}

function numberedProviders() {
  const providers = [];
  for (const prefix of numberedPrefixes()) {
    const provider = providerEnv(prefix);
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

export function providerChainDiagnostics() {
  const cfg = providerChainConfig();
  const issues = [];
  for (const prefix of numberedPrefixes()) {
    const issue = slotIssues(prefix);
    if (issue) issues.push(issue);
  }
  return {
    deterministic: cfg.deterministic,
    enabled: cfg.enabled,
    providers: cfg.providers.map((p) => ({ label: p.label, base: p.base, model: p.model, apiKey: redactKey(p.key) })),
    issues,
  };
}

const COOLDOWN_MS = Number(process.env.MCP_PROVIDER_COOLDOWN_MS || 60000);
const cooldowns = new Map();

export function isCoolingDown(key, now = Date.now()) {
  const until = cooldowns.get(key);
  if (!until) return false;
  if (now >= until) { cooldowns.delete(key); return false; }
  return true;
}

export function recordOutcome(key, ok, now = Date.now()) {
  if (ok) { cooldowns.delete(key); return; }
  cooldowns.set(key, now + COOLDOWN_MS);
}

export function _resetCooldowns() {
  cooldowns.clear();
}
