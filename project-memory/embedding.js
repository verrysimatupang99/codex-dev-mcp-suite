/**
 * Embedding helper for any OpenAI-compatible /v1/embeddings endpoint,
 * with first-class support for Cloudflare Workers AI (REST-only, non-OpenAI).
 *
 * Degrades gracefully: returns null/[] on any failure so callers fall back
 * to keyword search. Never throws.
 *
 * Endpoint formats:
 *  - OpenAI-compatible:  POST {base}/v1/embeddings   body: {model, input:[...]}
 *                        response: {data:[{embedding:[...], index}]}
 *  - Cloudflare Workers: POST {base}/{model}          body: {text:[...]}
 *                        response: {result:{data:[[...]], shape:[n,dim]}}
 *
 * Cloudflare is auto-detected by URL pattern (contains "api.cloudflare.com/client/v4/accounts").
 * To use it: set MCP_EMBED_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run/
 * and MCP_EMBED_MODEL=@cf/baai/bge-base-en-v1.5
 */
import http from "http";
import https from "https";
import { URL } from "url";
import { deterministicEnabled } from "./env.js";

/** Read env at runtime (not module-load time) so tests can override and config is dynamic). */
function readEnv() {
  return {
    base: process.env.MCP_EMBED_BASE_URL || process.env.MCP_LLM_BASE_URL || process.env.LLM_BASE_URL || process.env.EMBED_URL || process.env.NINEROUTER_URL || "http://localhost:20128",
    key: process.env.MCP_EMBED_API_KEY || process.env.MCP_LLM_API_KEY || process.env.LLM_API_KEY || process.env.EMBED_KEY || process.env.NINEROUTER_KEY || "",
    model: process.env.MCP_EMBED_MODEL || process.env.EMBED_MODEL || "bm/baai/bge-m3",
    timeoutMs: Number(process.env.EMBED_TIMEOUT_MS || 15000),
  };
}

/**
 * Resolve what retrieval mode memory_recall will use, given current env.
 * Returns one of: "deterministic" | "semantic" | "keyword".
 * Independent of MCP_RERANK_ENABLED (rerank layers on top of either).
 */
export function recallMode() {
  if (deterministicEnabled()) return "deterministic";
  const { key } = readEnv();
  return key ? "semantic" : "keyword";
}

export function embeddingConfig() {
  const { base, key, model } = readEnv();
  return {
    base,
    model,
    enabled: Boolean(key) && !deterministicEnabled(),
    deterministic: deterministicEnabled(),
    endpoint: isCloudflareURL(base) ? "cloudflare" : "openai-compatible",
    mode: recallMode(),
  };
}

/** Detect Cloudflare Workers AI by URL pattern. */
export function isCloudflareURL(urlStr) {
  return typeof urlStr === "string" && urlStr.includes("api.cloudflare.com/client/v4/accounts");
}

/**
 * POST a JSON body to an absolute URL with Bearer auth. Returns:
 *   { status: 200, body: <parsed JSON> } on success
 *   { status: <code>, body: <raw text> } on non-200
 *   null on network/timeout/parse error
 * Caller is responsible for building the full URL (we don't append /v1/embeddings etc).
 */
function httpPostJson(urlStr, payload) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch { return resolve(null); }
    const data = Buffer.from(JSON.stringify(payload));
    const { key, timeoutMs } = readEnv();
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length,
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) return resolve({ status: res.statusCode, body });
          try { resolve({ status: 200, body: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, body }); }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(data);
    req.end();
  });
}

async function embedOpenAI(inputs) {
  const { base, key, model } = readEnv();
  if (!key) return [];
  try {
    const res = await httpPostJson(`${base.replace(/\/$/, "")}/v1/embeddings`, { model, input: inputs });
    if (!res || res.status !== 200 || !res.body || !Array.isArray(res.body.data)) return [];
    const json = res.body;
    const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((d) => d.embedding).filter(Boolean);
  } catch { return []; }
}

async function embedCloudflare(inputs) {
  const { base: rawBase, key, model } = readEnv();
  if (!key) return [];
  // Cloudflare: model is in URL path; do NOT URL-encode ("@" and "/" must stay literal).
  const base = rawBase.replace(/\/$/, "");
  const url = `${base}/${model}`;
  try {
    const res = await httpPostJson(url, { text: inputs });
    if (!res || res.status !== 200 || !res.body || !res.body.result) return [];
    const data = res.body.result.data;
    if (!Array.isArray(data)) return [];
    return data.filter((v) => Array.isArray(v));
  } catch { return []; }
}

/**
 * Embed an array of strings (or a single string) and return an array of
 * numeric vectors. Returns [] when no API key is configured, deterministic
 * mode is on, or the endpoint fails.
 */
export async function embed(inputs) {
  if (deterministicEnabled()) return [];
  const { base, key } = readEnv();
  if (!key) return [];
  const arr = Array.isArray(inputs) ? inputs : [inputs];
  if (isCloudflareURL(base)) return await embedCloudflare(arr);
  return await embedOpenAI(arr);
}

export async function embedOne(text) {
  const v = await embed([text]);
  return v[0] || null;
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y; na += x * x; nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
