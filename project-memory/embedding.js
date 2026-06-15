/**
 * Embedding helper for any OpenAI-compatible /v1/embeddings endpoint.
 * Degrades gracefully: returns null on any failure so callers fall back
 * to keyword search. Never throws.
 */
import http from "http";
import https from "https";
import { URL } from "url";
import { deterministicEnabled } from "./env.js";

const BASE = process.env.MCP_EMBED_BASE_URL || process.env.MCP_LLM_BASE_URL || process.env.LLM_BASE_URL || process.env.EMBED_URL || process.env.NINEROUTER_URL || "http://localhost:20128";
const KEY = process.env.MCP_EMBED_API_KEY || process.env.MCP_LLM_API_KEY || process.env.LLM_API_KEY || process.env.EMBED_KEY || process.env.NINEROUTER_KEY || "";
const MODEL = process.env.MCP_EMBED_MODEL || process.env.EMBED_MODEL || "bm/baai/bge-m3";
const TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS || 15000);

export function embeddingConfig() {
  return { base: BASE, model: MODEL, enabled: Boolean(KEY) && !deterministicEnabled(), deterministic: deterministicEnabled() };
}

function postJson(urlStr, payload) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL("/v1/embeddings", urlStr); } catch { return resolve(null); }
    const data = Buffer.from(JSON.stringify(payload));
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length,
          Authorization: `Bearer ${KEY}`,
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) return resolve(null);
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(data);
    req.end();
  });
}

/** Returns array of vectors aligned to inputs, or null if unavailable. */
export async function embed(inputs) {
  if (!KEY || deterministicEnabled()) return null;
  const arr = Array.isArray(inputs) ? inputs : [inputs];
  if (arr.length === 0) return [];
  const json = await postJson(BASE, { model: MODEL, input: arr });
  if (!json || !Array.isArray(json.data)) return null;
  try {
    const sorted = json.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vecs = sorted.map((d) => d.embedding);
    if (vecs.some((v) => !Array.isArray(v) || v.length === 0)) return null;
    return vecs;
  } catch { return null; }
}

export async function embedOne(text) {
  const v = await embed([text]);
  return v ? v[0] : null;
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
