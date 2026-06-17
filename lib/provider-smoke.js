/**
 * Dev MCP Suite — provider smoke library.
 *
 * Builds a "matrix" of providers from environment variables (matching the
 * convention used by project-memory / devjournal servers: `MCP_*` neutral,
 * `NINEROUTER_*` / `LLM_*` / `EMBED_*` legacy aliases), then exposes
 * helpers to shape probe results and format them as text/JSON/markdown.
 *
 * The actual HTTP probes are NOT done here — the CLI wires real `fetch`.
 * Keeping the lib free of network I/O makes it trivially testable offline.
 */

import os from "os";

/**
 * Static metadata for well-known providers. `supportsEmbed: false` means
 * the provider does not expose an OpenAI-compatible /v1/embeddings endpoint
 * (e.g. Groq, Cerebras — they focus on inference speed).
 */
export function isCloudflareURL(urlStr) {
  return typeof urlStr === "string" && urlStr.includes("api.cloudflare.com/client/v4/accounts");
}

export const KNOWN_PROVIDERS = {
  // Inference-only (no embeddings endpoint)
  groq:       { supportsChat: true,  supportsEmbed: false, defaultBase: "https://api.groq.com/openai/v1",              defaultModel: "llama-3.3-70b-versatile", notes: "OpenAI-compatible; inference-only" },
  cerebras:   { supportsChat: true,  supportsEmbed: false, defaultBase: "https://api.cerebras.ai/v1",                 defaultModel: "gpt-oss-120b",          notes: "OpenAI-compatible; inference-only" },
  anthropic:  { supportsChat: true,  supportsEmbed: false, defaultBase: "https://api.anthropic.com/v1",                defaultModel: null,                   notes: "No embeddings API" },

  // Embeddings + chat
  openai:     { supportsChat: true,  supportsEmbed: true,  defaultBase: "https://api.openai.com/v1",                  defaultModel: "text-embedding-3-small", notes: "Reference impl; paid (~$0.02/1M tok)" },
  mistral:    { supportsChat: true,  supportsEmbed: true,  defaultBase: "https://api.mistral.ai/v1",                  defaultModel: "mistral-embed",          notes: "OpenAI-compatible; paid w/ free tier" },
  openrouter: { supportsChat: true,  supportsEmbed: true,  defaultBase: "https://openrouter.ai/api/v1",                defaultModel: "openai/text-embedding-3-small", notes: "Aggregator; many free models available" },
  gemini:     { supportsChat: true,  supportsEmbed: true,  defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "text-embedding-004", notes: "Google; OpenAI-compatible; generous free tier" },
  cohere:     { supportsChat: true,  supportsEmbed: true,  defaultBase: "https://api.cohere.ai/v1",                   defaultModel: "embed-multilingual-v3.0", notes: "Top multilingual; trial + paid" },
  voyage:     { supportsChat: false, supportsEmbed: true,  defaultBase: "https://api.voyageai.com/v1",                defaultModel: "voyage-3",               notes: "Embeddings-only; 200M free on signup" },

  // Local (free, unlimited, uses laptop resources)
  ollama:     { supportsChat: true,  supportsEmbed: true,  defaultBase: "http://localhost:11434/v1",                  defaultModel: "nomic-embed-text",       notes: "Local; runs on laptop CPU/GPU/RAM" },

  // Non-OpenAI-compatible (requires custom code path in embedding.js)
  cloudflare: { supportsChat: true,  supportsEmbed: true,  defaultBase: null,                                          defaultModel: "@cf/baai/bge-base-en-v1.5", endpoint: "cloudflare", notes: "REST-only API; NOT OpenAI-compatible; 10K neurons/day free; model goes in URL path" },

  // Local proxy / aggregator (not OpenAI by default; configured via env)
  "9router":  { supportsChat: true,  supportsEmbed: true,  defaultBase: null,                                          defaultModel: null,                   notes: "Self-hosted OpenAI-compatible aggregator" },
};

function pickEnv(env, names) {
  for (const n of names) if (env[n]) return env[n];
  return undefined;
}

/** Read a provider slot (PRIMARY, CHAIN2..N) into a normalized record. */
function readProviderSlot(env, slot /* PRIMARY | CHAIN2 | CHAIN3 | ... */) {
  const upper = slot.toUpperCase();
  const name = pickEnv(env, [
    `MCP_PROVIDER_${upper}`,
    `MCP_PROVIDER_${upper}_NAME`,
  ]);
  if (!name) return null;
  const lower = name.toLowerCase();
  const baseUrl = pickEnv(env, [`MCP_PROVIDER_${upper}_BASE_URL`]);
  const apiKey  = pickEnv(env, [`MCP_PROVIDER_${upper}_API_KEY`]);
  const chatModel = pickEnv(env, [`MCP_PROVIDER_${upper}_MODEL`, `MCP_PROVIDER_${upper}_CHAT_MODEL`]);
  const embedModel = pickEnv(env, [`MCP_PROVIDER_${upper}_EMBED_MODEL`]);
  const meta = KNOWN_PROVIDERS[lower] || {};
  return {
    id: lower,
    name,
    baseUrl: baseUrl || meta.defaultBase || null,
    apiKey: apiKey || null,
    chatModel: chatModel || meta.defaultModel || null,
    embedModel: embedModel || null,
    supportsChat: meta.supportsChat !== false,
    supportsEmbed: meta.supportsEmbed === true && Boolean(embedModel || meta.defaultModel),
    source: `MCP_PROVIDER_${upper}`,
  };
}

/** Read a "named" provider from explicit env (e.g. MISTRAL_*, OPENAI_*, GROQ_*). */
function readNamedProvider(env, id) {
  const upper = id.toUpperCase();
  const apiKey = pickEnv(env, [`${upper}_API_KEY`, `${upper}_KEY`, `MCP_${upper}_API_KEY`]);
  const baseUrl = pickEnv(env, [`${upper}_BASE_URL`, `${upper}_URL`, `MCP_${upper}_BASE_URL`]);
  const chatModel = pickEnv(env, [`${upper}_MODEL`, `${upper}_CHAT_MODEL`, `MCP_${upper}_MODEL`]);
  const embedModel = pickEnv(env, [`${upper}_EMBED_MODEL`, `MCP_EMBED_MODEL`, `${upper}_MODEL`]);
  if (!apiKey && !baseUrl) return null;
  const meta = KNOWN_PROVIDERS[id] || {};
  // For single-model providers (e.g. Cloudflare), the configured model is used for both chat and embed.
  const effectiveChatModel = chatModel || meta.defaultModel || embedModel || null;
  const effectiveEmbedModel = embedModel || meta.defaultModel || chatModel || null;
  const effectiveBaseUrl = baseUrl || meta.defaultBase || null;
  return {
    id,
    name: id,
    baseUrl: effectiveBaseUrl,
    apiKey: apiKey || null,
    chatModel: effectiveChatModel,
    embedModel: effectiveEmbedModel,
    supportsChat: meta.supportsChat !== false,
    supportsEmbed: meta.supportsEmbed === true && Boolean(effectiveEmbedModel),
    endpoint: meta.endpoint || (effectiveBaseUrl && isCloudflareURL(effectiveBaseUrl) ? "cloudflare" : "openai-compatible"),
    source: `${upper}_*`,
  };
}

/** Read the existing 9router/agentrouter config used by project-memory / devjournal. */
function read9routerLike(env) {
  const baseUrl = pickEnv(env, [
    "MCP_LLM_BASE_URL", "MCP_RERANK_BASE_URL", "MCP_EMBED_BASE_URL",
    "LLM_BASE_URL", "EMBED_URL", "NINEROUTER_URL", "RERANK_URL",
  ]);
  const apiKey = pickEnv(env, [
    "MCP_LLM_API_KEY", "MCP_RERANK_API_KEY", "MCP_EMBED_API_KEY",
    "LLM_API_KEY", "EMBED_KEY", "NINEROUTER_KEY", "RERANK_KEY",
  ]);
  if (!baseUrl && !apiKey) return null;
  // Heuristic: label the catch-all based on host for clarity in output.
  const host = baseUrl ? new URL(baseUrl).hostname : "";
  let id = "openai-compatible";
  if (/9router|agentrouter/i.test(host)) id = "9router";
  return {
    id,
    name: id,
    baseUrl: baseUrl || null,
    apiKey: apiKey || null,
    chatModel: pickEnv(env, [
      "MCP_RERANK_MODEL", "MCP_LLM_MODEL", "RERANK_MODEL", "LLM_MODEL",
      "NINEROUTER_CHAT_MODEL", "NINEROUTER_RERANK_MODEL", "NINEROUTER_MODEL",
    ]) || null,
    embedModel: pickEnv(env, [
      "MCP_EMBED_MODEL", "EMBED_MODEL", "NINEROUTER_EMBED_MODEL",
    ]) || null,
    supportsChat: true,
    supportsEmbed: true,
    source: "MCP_LLM_BASE_URL",
  };
}

/**
 * Build the provider matrix from environment variables.
 * Returns a deduplicated list of provider records.
 * @param {Record<string,string|undefined>} env
 * @returns {Array<{id, name, baseUrl, apiKey, chatModel, embedModel, supportsChat, supportsEmbed, source}>}
 */
export function buildProviderMatrix(env) {
  const out = [];
  const seen = new Set();

  const push = (p) => {
    if (!p || !p.baseUrl && !p.apiKey) return;
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push(p);
  };

  // 1. Primary + numbered slots
  push(readProviderSlot(env, "PRIMARY"));
  for (let i = 2; i <= 10; i++) {
    push(readProviderSlot(env, `CHAIN${i}`));
  }

  // 2. Named providers (Groq, Cerebras, Mistral, OpenRouter, OpenAI, Ollama)
  for (const id of ["groq", "cerebras", "mistral", "openrouter", "openai", "ollama", "anthropic", "gemini", "cohere", "voyage", "cloudflare"]) {
    push(readNamedProvider(env, id));
  }

  // 3. Catch-all: existing 9router-like config from MCP_LLM_BASE_URL etc.
  push(read9routerLike(env));

  return out;
}

/**
 * Shape a probe result into the canonical record used by formatting helpers.
 */
export function shapeProbe({ name, kind, ok, latencyMs = null, status = null, sample = null, error = null, dim = null }) {
  return { name, kind, ok, latencyMs, status, sample, error, dim };
}

// ---- formatting ----

function fmtLatency(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatText(results) {
  const lines = [];
  lines.push("Dev MCP Suite — provider smoke");
  lines.push("==============================");
  // group by provider
  const byName = new Map();
  for (const r of results) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  for (const [name, rs] of byName) {
    lines.push(`\n[${name}]`);
    for (const r of rs) {
      const mark = r.ok ? "✓" : "✗";
      const lat = r.ok ? fmtLatency(r.latencyMs) : "";
      const detail = r.ok
        ? `${r.status || ""} ${lat}${r.sample ? `  "${String(r.sample).slice(0, 40)}"` : ""}${r.dim ? `  dim=${r.dim}` : ""}`.trim()
        : `${r.status || "—"}  ${r.error || "unknown error"}`;
      lines.push(`  ${mark} ${r.kind.padEnd(10)} ${detail}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function formatJson(results) {
  return JSON.stringify(results, null, 2);
}

export function formatMarkdown(results) {
  const lines = [];
  lines.push("# Provider smoke matrix");
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push("");
  lines.push("| Provider | Kind | Status | Latency | HTTP | Sample / dim | Error |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of results) {
    const okMark = r.ok ? "✓" : "✗";
    const sample = r.ok ? (r.sample ? `\`${String(r.sample).slice(0, 30)}\`` : (r.dim ? `dim=${r.dim}` : "—")) : "—";
    const err = r.ok ? "" : (r.error || "").replace(/\|/g, "\\|");
    lines.push(`| ${r.name} | ${r.kind} | ${okMark} | ${fmtLatency(r.latencyMs)} | ${r.status || "—"} | ${sample} | ${err} |`);
  }
  lines.push("");
  return lines.join("\n");
}
