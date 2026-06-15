/**
 * LLM reranker via any OpenAI-compatible /v1/chat/completions model.
 * Tries provider chain slots in order, skipping any currently cooling down
 * after a recent failure. Degrades gracefully: returns null on any failure so
 * callers fall back to keyword ordering. Never throws. Never logs keys/bodies.
 */
import http from "http";
import https from "https";
import { URL } from "url";
import { deterministicEnabled } from "./env.js";
import { providerChainConfig, isCoolingDown, recordOutcome } from "./provider-chain.js";

const TIMEOUT_MS = Number(process.env.RERANK_TIMEOUT_MS || 30000);
const ENABLED = process.env.RERANK_ENABLED !== "0";

export function rerankConfig() {
  const cfg = providerChainConfig();
  const first = cfg.providers[0] || {};
  return {
    base: first.base,
    model: first.model,
    providers: cfg.providers.map(({ label, base, model }) => ({ label, base, model })),
    enabled: ENABLED && cfg.enabled && !deterministicEnabled(),
    deterministic: deterministicEnabled(),
  };
}

function providerKey(provider) {
  return `${provider.label}|${provider.base}|${provider.model}`;
}

/**
 * Resolves { content, retryable }. retryable=true means try the next provider
 * (timeout, network error, 429, or 5xx). retryable=false with null content
 * means a definitive non-retryable response (e.g. 4xx auth).
 */
function chatWithProvider(provider, messages) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL("/v1/chat/completions", provider.base); } catch { return resolve({ content: null, retryable: false }); }
    const payload = Buffer.from(JSON.stringify({ model: provider.model, stream: false, temperature: 0, max_tokens: 200, messages }));
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": payload.length, Authorization: `Bearer ${provider.key}` },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          if (status !== 200) {
            const retryable = status === 429 || status >= 500;
            return resolve({ content: null, retryable });
          }
          try {
            const j = JSON.parse(body);
            return resolve({ content: j?.choices?.[0]?.message?.content ?? null, retryable: false });
          } catch { /* maybe SSE */ }
          try {
            let acc = "";
            for (const line of body.split("\n")) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              const d = t.slice(5).trim();
              if (d === "[DONE]") break;
              const j = JSON.parse(d);
              acc += j?.choices?.[0]?.delta?.content || j?.choices?.[0]?.message?.content || "";
            }
            return resolve({ content: acc || null, retryable: false });
          } catch { return resolve({ content: null, retryable: true }); }
        });
      }
    );
    req.on("error", () => resolve({ content: null, retryable: true }));
    req.on("timeout", () => { req.destroy(); resolve({ content: null, retryable: true }); });
    req.write(payload);
    req.end();
  });
}

async function chat(messages) {
  if (!ENABLED || deterministicEnabled()) return null;
  const { providers } = providerChainConfig();
  for (const provider of providers) {
    const key = providerKey(provider);
    if (isCoolingDown(key)) continue;
    const { content, retryable } = await chatWithProvider(provider, messages);
    if (content) { recordOutcome(key, true); return content; }
    if (retryable) recordOutcome(key, false);
  }
  return null;
}

/**
 * Given a query and candidates [{id, title, snippet}], ask the model to return
 * the ids ordered by relevance. Returns an array of ids, or null on failure.
 */
export async function rerank(query, candidates, topK = 5) {
  if (!ENABLED || deterministicEnabled() || !candidates || candidates.length === 0 || !providerChainConfig().enabled) return null;
  const list = candidates.map((c, i) => `[${i + 1}] (id:${c.id}) ${c.title}\n    ${String(c.snippet || "").replace(/\s+/g, " ").slice(0, 200)}`).join("\n");
  const sys = "You are a search reranker. Given a user query and a numbered list of notes, return the most relevant notes ordered best-first. Respond with ONLY a comma-separated list of the bracket numbers, e.g. 3,1,5. No prose.";
  const user = `Query: ${query}\n\nNotes:\n${list}\n\nReturn the top ${topK} bracket numbers, best first, comma-separated:`;
  const out = await chat([{ role: "system", content: sys }, { role: "user", content: user }]);
  if (!out) return null;
  const nums = (out.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= candidates.length);
  if (nums.length === 0) return null;
  const seen = new Set();
  const ordered = [];
  for (const n of nums) {
    const id = candidates[n - 1]?.id;
    if (id && !seen.has(id)) { seen.add(id); ordered.push(id); }
  }
  return ordered.length ? ordered : null;
}
