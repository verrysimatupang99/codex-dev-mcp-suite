/**
 * Tests for provider-smoke library.
 * Run directly: node tests/provider-smoke.test.mjs
 */
import {
  describe, it, assert, assertEqual, run, tmpDir, rmrf,
} from "../_testkit/harness.mjs";
import {
  buildProviderMatrix,
  KNOWN_PROVIDERS,
  formatText,
  formatJson,
  formatMarkdown,
  shapeProbe,
} from "../lib/provider-smoke.js";

describe("buildProviderMatrix", () => {
  it("includes openai-compatible (e.g. 9router) from MCP_LLM_BASE_URL env", () => {
    const env = {
      MCP_LLM_BASE_URL: "https://agentrouter.org/v1",
      MCP_LLM_API_KEY: "sk-test",
    };
    const m = buildProviderMatrix(env);
    const r = m.find((x) => x.id === "9router");
    assert(r, "expected 9router entry (auto-detected from host)");
    assertEqual(r.baseUrl, "https://agentrouter.org/v1");
  });

  it("labels generic OpenAI-compatible endpoints as 'openai-compatible'", () => {
    const env = {
      MCP_LLM_BASE_URL: "https://my-proxy.example.com/v1",
      MCP_LLM_API_KEY: "sk-test",
    };
    const m = buildProviderMatrix(env);
    const r = m.find((x) => x.id === "openai-compatible");
    assert(r);
    assertEqual(r.baseUrl, "https://my-proxy.example.com/v1");
  });

  it("includes groq from MCP_PROVIDER_PRIMARY=groq", () => {
    const env = {
      MCP_PROVIDER_PRIMARY: "groq",
      MCP_PROVIDER_PRIMARY_BASE_URL: "https://api.groq.com/openai/v1",
      MCP_PROVIDER_PRIMARY_API_KEY: "gsk_test",
      MCP_PROVIDER_PRIMARY_MODEL: "llama-3.3-70b-versatile",
    };
    const m = buildProviderMatrix(env);
    const g = m.find((x) => x.id === "groq");
    assert(g);
    assertEqual(g.baseUrl, "https://api.groq.com/openai/v1");
    assert(g.supportsChat);
    assertEqual(g.supportsEmbed, false);
  });

  it("includes cerebras from MCP_PROVIDER_CHAIN2", () => {
    const env = {
      MCP_PROVIDER_CHAIN2: "cerebras",
      MCP_PROVIDER_CHAIN2_BASE_URL: "https://api.cerebras.ai/v1",
      MCP_PROVIDER_CHAIN2_API_KEY: "csk-test",
      MCP_PROVIDER_CHAIN2_MODEL: "gpt-oss-120b",
    };
    const m = buildProviderMatrix(env);
    const c = m.find((x) => x.id === "cerebras");
    assert(c);
    assert(c.supportsChat);
    assertEqual(c.supportsEmbed, false);
  });

  it("includes mistral, openrouter, openai when env present", () => {
    const env = {
      MISTRAL_API_KEY: "ms-test",
      MISTRAL_BASE_URL: "https://api.mistral.ai/v1",
      OPENROUTER_API_KEY: "or-test",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
    };
    const m = buildProviderMatrix(env);
    assert(m.find((x) => x.id === "mistral"));
    assert(m.find((x) => x.id === "openrouter"));
    assert(m.find((x) => x.id === "openai"));
  });

  it("includes gemini via GEMINI_* env (OpenAI-compatible endpoint)", () => {
    const env = {
      GEMINI_API_KEY: "gm-test",
      GEMINI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
      GEMINI_MODEL: "text-embedding-004",
    };
    const m = buildProviderMatrix(env);
    const g = m.find((x) => x.id === "gemini");
    assert(g);
    assertEqual(g.supportsEmbed, true);
  });

  it("includes ollama from OLLAMA_BASE_URL env", () => {
    const env = {
      OLLAMA_BASE_URL: "http://localhost:11434/v1",
      OLLAMA_MODEL: "nomic-embed-text",
    };
    const m = buildProviderMatrix(env);
    const o = m.find((x) => x.id === "ollama");
    assert(o);
    assertEqual(o.baseUrl, "http://localhost:11434/v1");
    assertEqual(o.supportsEmbed, true);
  });

  it("dedupes: 9router + groq (different ids) both appear", () => {
    const env = {
      MCP_LLM_BASE_URL: "https://agentrouter.org/v1",
      MCP_LLM_API_KEY: "sk-1",
      MCP_PROVIDER_PRIMARY: "groq",
      MCP_PROVIDER_PRIMARY_BASE_URL: "https://api.groq.com/openai/v1",
      MCP_PROVIDER_PRIMARY_API_KEY: "gsk-1",
      MCP_PROVIDER_PRIMARY_MODEL: "llama-3.3-70b-versatile",
    };
    const m = buildProviderMatrix(env);
    const ids = m.map((x) => x.id).sort();
    assert(ids.includes("9router"));
    assert(ids.includes("groq"));
  });

  it("returns empty matrix when no provider env is set", () => {
    assertEqual(buildProviderMatrix({}).length, 0);
  });
});

describe("KNOWN_PROVIDERS metadata", () => {
  it("flags chat-only providers (groq, cerebras, anthropic)", () => {
    assertEqual(KNOWN_PROVIDERS.groq.supportsEmbed, false);
    assertEqual(KNOWN_PROVIDERS.cerebras.supportsEmbed, false);
    assertEqual(KNOWN_PROVIDERS.anthropic.supportsEmbed, false);
  });

  it("flags embed-capable providers (openai, mistral, gemini, cohere, voyage, ollama, openrouter)", () => {
    for (const id of ["openai", "mistral", "gemini", "cohere", "voyage", "ollama", "openrouter"]) {
      assertEqual(KNOWN_PROVIDERS[id].supportsEmbed, true, `${id} should support embed`);
    }
  });

  it("flags cloudflare as non-OpenAI-compatible (REST-only)", () => {
    assertEqual(KNOWN_PROVIDERS.cloudflare.supportsEmbed, true, "cloudflare CAN embed, but needs custom code path");
    assert(KNOWN_PROVIDERS.cloudflare.notes?.toLowerCase().includes("not openai"), "cloudflare should have a not-OpenAI note");
  });

  it("every provider has a notes field for clarity", () => {
    for (const [id, meta] of Object.entries(KNOWN_PROVIDERS)) {
      assert(meta.notes, `${id} should have notes`);
    }
  });
});

describe("shapeProbe", () => {
  it("builds ok result", () => {
    const r = shapeProbe({ name: "groq", kind: "chat", ok: true, latencyMs: 234, status: 200, sample: "hi" });
    assertEqual(r.ok, true);
    assertEqual(r.latencyMs, 234);
  });
  it("builds fail result", () => {
    const r = shapeProbe({ name: "x", kind: "embed", ok: false, status: 503, error: "no channel" });
    assertEqual(r.ok, false);
    assertEqual(r.error, "no channel");
  });
});

describe("formatText", () => {
  it("renders table", () => {
    const text = formatText([
      { name: "groq", kind: "chat", ok: true, latencyMs: 234, status: 200, sample: "hello" },
      { name: "groq", kind: "embed", ok: false, error: "no endpoint" },
    ]);
    assertIncludes(text, "groq");
    assertIncludes(text, "✓");
    assertIncludes(text, "✗");
  });
});

describe("formatJson", () => {
  it("valid JSON", () => {
    const j = JSON.parse(formatJson([{ name: "x", kind: "chat", ok: true, latencyMs: 10, status: 200 }]));
    assertEqual(j[0].name, "x");
  });
});

describe("formatMarkdown", () => {
  it("produces table", () => {
    const md = formatMarkdown([
      { name: "groq", kind: "chat", ok: true, latencyMs: 234, status: 200 },
      { name: "9router", kind: "embed", ok: false, error: "503" },
    ]);
    assertIncludes(md, "| Provider |");
    assertIncludes(md, "| groq |");
    assertIncludes(md, "✓");
    assertIncludes(md, "✗");
  });
});

function assertIncludes(a, b, m) {
  if (!String(a).includes(String(b))) throw new Error(`expected "${a}" to include "${b}"${m ? " — " + m : ""}`);
}

await run();
