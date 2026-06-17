#!/usr/bin/env node
/**
 * bin/provider-smoke.mjs — Dev MCP Suite provider smoke test.
 *
 * Probes every provider that can be derived from the current env:
 *   - MCP_LLM_BASE_URL / NINEROUTER_URL / LLM_BASE_URL (9router-like)
 *   - MCP_PROVIDER_PRIMARY / _CHAIN2 / _CHAIN3 / ... (numbered slots)
 *   - Named: GROQ_*, CEREBRAS_*, MISTRAL_*, OPENROUTER_*, OPENAI_*, OLLAMA_*, ...
 *
 * For each provider, runs:
 *   - chat probe (/v1/chat/completions, short prompt)         if supportsChat
 *   - embed probe (/v1/embeddings, single string)             if supportsEmbed
 *
 * Output: human text by default; --json for machines; --markdown for docs.
 *
 * Env override:
 *   --env-file <path>   Source env from this file before probing (e.g. /tmp/secrets.env)
 *
 * Exit code:
 *   0 = all probes ok
 *   1 = at least one probe failed
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { buildProviderMatrix, shapeProbe, formatText, formatJson, formatMarkdown, isCloudflareURL } from "../lib/provider-smoke.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || "unknown";
  } catch { return "unknown"; }
}


/** Strip a trailing /v1 (only the literal segment, not /openai/v1) so we can re-append /v1/<endpoint>. */
function stripV1(baseUrl) {
  return String(baseUrl || "").replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

function parseArgs(argv) {
  const opts = {
    help: false, version: false,
    json: false, markdown: false,
    saveMd: null, envFile: null,
    chatOnly: false, embedOnly: false,
    timeoutMs: 15000,
    only: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-v" || a === "--version") opts.version = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--markdown") opts.markdown = true;
    else if (a === "--save-md") opts.saveMd = argv[++i];
    else if (a === "--env-file") opts.envFile = argv[++i];
    else if (a === "--chat-only") opts.chatOnly = true;
    else if (a === "--embed-only") opts.embedOnly = true;
    else if (a === "--timeout") opts.timeoutMs = parseInt(argv[++i], 10) || 15000;
    else if (a === "--only") opts.only = (argv[++i] || "").split(",").map(s => s.trim()).filter(Boolean);
    else { process.stderr.write(`provider-smoke: unknown flag: ${a}\n`); process.exit(2); }
  }
  return opts;
}

function printHelp() {
  const out = [
    `provider-smoke (Dev MCP Suite) v${pkgVersion()}`,
    "",
    "Probe every configured LLM provider (chat + embeddings) and print a matrix.",
    "",
    "Usage:",
    "  provider-smoke [--json] [--markdown] [--save-md <path>]",
    "                 [--chat-only | --embed-only] [--env-file <path>]",
    "  provider-smoke --help | --version",
    "",
    "Options:",
    "  --json            Machine-readable JSON output",
    "  --markdown        Markdown table (for docs/)",
    "  --save-md <path>  Write markdown report to this file",
    "  --env-file <path> Source env vars from this file before probing",
    "                    (KEY=value lines, one per line)",
    "  --chat-only       Only probe /v1/chat/completions",
    "  --embed-only      Only probe /v1/embeddings",
    "  --timeout <ms>    Per-probe timeout (default 15000)",
    "  --only a,b,c      Only probe these provider ids (comma-separated); others ignored",
    "",
    "Detected providers (precedence):",
    "  MCP_PROVIDER_PRIMARY / _CHAIN2 / _CHAIN3 / ...   (numbered slots)",
    "  GROQ_*, CEREBRAS_*, MISTRAL_*, OPENROUTER_*,     (named)",
    "  OPENAI_*, OLLAMA_*, ANTHROPIC_*, GEMINI_*, COHERE_*",
    "  MCP_LLM_BASE_URL / NINEROUTER_URL / LLM_BASE_URL  (9router / agentrouter)",
    "",
    "Examples:",
    "  provider-smoke",
    "  provider-smoke --env-file /tmp/codex-dev-smoke.env",
    "  provider-smoke --json | jq '.[] | select(.ok == false)'",
    "  provider-smoke --markdown --save-md docs/providers.md",
  ];
  process.stdout.write(out.join("\n") + "\n");
}

function loadEnvFile(file) {
  if (!file) return {};
  const text = fs.readFileSync(file, "utf8");
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function buildHeaders(provider) {
  const h = { "Content-Type": "application/json" };
  if (provider.apiKey) h["Authorization"] = `Bearer ${provider.apiKey}`;
  return h;
}


const CF_EMBED_ONLY_PREFIXES = ["@cf/baai/", "@cf/google/embedding", "@cf/baai/sentence-"];

function isEmbedOnlyModel(model) {
  if (!model) return false;
  return CF_EMBED_ONLY_PREFIXES.some((p) => model.startsWith(p));
}

async function probeCloudflare(provider, timeoutMs, kind) {
  // Skip chat probe for known embed-only Cloudflare model prefixes (annotate, not error).
  if (kind === "chat" && isEmbedOnlyModel(provider.chatModel || provider.embedModel)) {
    return shapeProbe({ name: provider.id, kind: "chat", ok: false, error: "embed-only model (chat not supported)" });
  }
  // Cloudflare Workers AI REST: POST {baseUrl}/{model}, body shape depends on kind.
  // Cloudflare model names contain "/" (e.g. "@cf/baai/bge-base-en-v1.5"); do NOT URL-encode.
  const url = `${provider.baseUrl.replace(/\/$/, "")}/${provider.chatModel || provider.embedModel}`;
  let body;
  if (kind === "chat") {
    body = JSON.stringify({
      messages: [{ role: "user", content: "Say the single word: OK" }],
      max_tokens: 8,
    });
  } else {
    body = JSON.stringify({ text: ["ping"] });
  }
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "POST", headers: buildHeaders(provider), body, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    const latencyMs = Date.now() - t0;
    if (res.status !== 200) {
      return shapeProbe({ name: provider.id, kind, ok: false, status: res.status, latencyMs, error: text.slice(0, 200) });
    }
    let sample = null, dim = null;
    try {
      const j = JSON.parse(text);
      if (kind === "embed") {
        const data = j?.result?.data;
        if (Array.isArray(data) && Array.isArray(data[0])) dim = data[0].length;
      } else {
        sample = j?.result?.response ?? null;
      }
    } catch { /* ignore */ }
    return shapeProbe({ name: provider.id, kind, ok: true, status: res.status, latencyMs, sample, dim });
  } catch (e) {
    return shapeProbe({ name: provider.id, kind, ok: false, latencyMs: Date.now() - t0, error: String(e && e.message || e) });
  }
}

async function probeChat(provider, timeoutMs) {
  if (!provider.baseUrl || !provider.chatModel) {
    return shapeProbe({ name: provider.id, kind: "chat", ok: false, error: "missing baseUrl or chatModel" });
  }
  const endpoint = provider.endpoint || (isCloudflareURL(provider.baseUrl) ? "cloudflare" : "openai-compatible");
  if (endpoint === "cloudflare") return probeCloudflare(provider, timeoutMs, "chat");
  const url = `${stripV1(provider.baseUrl)}/v1/chat/completions`;
  const body = JSON.stringify({
    model: provider.chatModel,
    messages: [{ role: "user", content: "Say the single word: OK" }],
    max_tokens: 8,
    temperature: 0,
  });
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "POST", headers: buildHeaders(provider), body, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    const latencyMs = Date.now() - t0;
    if (res.status !== 200) {
      return shapeProbe({ name: provider.id, kind: "chat", ok: false, status: res.status, latencyMs, error: text.slice(0, 200) });
    }
    let sample = null;
    try {
      const j = JSON.parse(text);
      sample = j?.choices?.[0]?.message?.content ?? null;
    } catch { /* ignore */ }
    return shapeProbe({ name: provider.id, kind: "chat", ok: true, status: res.status, latencyMs, sample });
  } catch (e) {
    return shapeProbe({ name: provider.id, kind: "chat", ok: false, latencyMs: Date.now() - t0, error: String(e && e.message || e) });
  }
}

async function probeEmbed(provider, timeoutMs) {
  if (!provider.supportsEmbed) {
    return shapeProbe({ name: provider.id, kind: "embed", ok: false, error: "provider has no /v1/embeddings endpoint" });
  }
  if (!provider.baseUrl || !provider.embedModel) {
    return shapeProbe({ name: provider.id, kind: "embed", ok: false, error: "missing baseUrl or embedModel" });
  }
  if (provider.endpoint === "cloudflare" || isCloudflareURL(provider.baseUrl)) return probeCloudflare(provider, timeoutMs, "embed");
  const url = `${stripV1(provider.baseUrl)}/v1/embeddings`;
  const body = JSON.stringify({ model: provider.embedModel, input: "ping" });
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "POST", headers: buildHeaders(provider), body, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    const latencyMs = Date.now() - t0;
    if (res.status !== 200) {
      return shapeProbe({ name: provider.id, kind: "embed", ok: false, status: res.status, latencyMs, error: text.slice(0, 200) });
    }
    let dim = null;
    try {
      const j = JSON.parse(text);
      dim = Array.isArray(j?.data?.[0]?.embedding) ? j.data[0].embedding.length : null;
    } catch { /* ignore */ }
    return shapeProbe({ name: provider.id, kind: "embed", ok: true, status: res.status, latencyMs, dim });
  } catch (e) {
    return shapeProbe({ name: provider.id, kind: "embed", ok: false, latencyMs: Date.now() - t0, error: String(e && e.message || e) });
  }
}

const opts = parseArgs(process.argv.slice(2));
if (opts.version) { process.stdout.write(`${pkgVersion()}\n`); process.exit(0); }
if (opts.help) { printHelp(); process.exit(0); }

// Merge env: process.env + (optional) env file
const fileEnv = loadEnvFile(opts.envFile);
const env = { ...process.env, ...fileEnv };

let matrix = buildProviderMatrix(env);
if (opts.only && opts.only.length) {
  matrix = matrix.filter(p => opts.only.includes(p.id));
}
if (matrix.length === 0) {
  const hint = opts.only && opts.only.length ? " (--only filter: " + opts.only.join(",") + ")" : "";
  process.stderr.write("No providers detected. Set MCP_PROVIDER_PRIMARY / GROQ_API_KEY / NINEROUTER_URL etc., or pass --env-file." + hint + "\n");
  process.exit(2);
}

process.stderr.write(`Probing ${matrix.length} provider${matrix.length === 1 ? "" : "s"}...\n`);
const results = [];
for (const p of matrix) {
  if (!opts.embedOnly && p.supportsChat) {
    results.push(await probeChat(p, opts.timeoutMs));
  }
  if (!opts.chatOnly && p.supportsEmbed) {
    results.push(await probeEmbed(p, opts.timeoutMs));
  }
}

let out;
if (opts.markdown) out = formatMarkdown(results);
else if (opts.json) out = formatJson(results);
else out = formatText(results);

process.stdout.write(out + "\n");

if (opts.saveMd) {
  fs.mkdirSync(path.dirname(opts.saveMd), { recursive: true });
  fs.writeFileSync(opts.saveMd, formatMarkdown(results));
  process.stderr.write(`Markdown saved to ${opts.saveMd}\n`);
}

const failed = results.filter((r) => !r.ok).length;
process.exit(failed === 0 ? 0 : 1);
