import { McpClient, describe, it, assert, assertIncludes, run, tmpDir, rmrf } from "../_testkit/harness.mjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "server.js");
const STORE = tmpDir("jrnl-");
const PROJ = "/tmp/jrnl-demo-project";

const client = new McpClient(SERVER, { JOURNAL_DIR: STORE });

describe("devjournal", () => {
  it("labels search as deterministic when hard no-network mode is enabled", async () => {
    const detStore = tmpDir("jrnl-det-");
    const detClient = new McpClient(SERVER, { JOURNAL_DIR: detStore, MCP_DETERMINISTIC_FALLBACK: "yes", MCP_LLM_API_KEY: "should-not-be-used" });
    await detClient.start();
    try {
      await detClient.callTool("journal_log", { dir: "/tmp/jrnl-det-project", title: "Local search", type: "done", body: "deterministic mode skips rerank" });
      const r = await detClient.callTool("journal_search", { dir: "/tmp/jrnl-det-project", query: "deterministic rerank" });
      assertIncludes(r.text, "[deterministic]");
    } finally {
      await detClient.stop();
      rmrf(detStore);
    }
  });

  it("prefers neutral MCP rerank env aliases", async () => {
    const old = { ...process.env };
    process.env.MCP_RERANK_BASE_URL = "http://journal-rerank.example/v1";
    process.env.MCP_RERANK_API_KEY = "journal-rerank-key";
    process.env.MCP_RERANK_MODEL = "journal-rerank-model";
    process.env.NINEROUTER_URL = "http://legacy.example";
    process.env.NINEROUTER_KEY = "legacy-key";
    process.env.RERANK_MODEL = "legacy-model";
    const { rerankConfig } = await import(`./rerank.js?alias-test=${Date.now()}`);
    const cfg = rerankConfig();
    assert(cfg.base === "http://journal-rerank.example/v1", "MCP_RERANK_BASE_URL should win");
    assert(cfg.model === "journal-rerank-model", "MCP_RERANK_MODEL should win");
    assert(cfg.enabled === true, "MCP_RERANK_API_KEY should enable rerank");
    process.env = old;
  });

  it("builds provider chain with legacy fallback", async () => {
    const old = { ...process.env };
    process.env = { ...old };
    for (const k of Object.keys(process.env)) if (k.startsWith("MCP_PROVIDER_") || k.startsWith("MCP_RERANK_") || k.startsWith("MCP_LLM_") || k === "RERANK_ENABLED" || k === "MCP_DETERMINISTIC_FALLBACK") delete process.env[k];
    process.env.MCP_PROVIDER_PRIMARY = "groq";
    process.env.MCP_PROVIDER_PRIMARY_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.MCP_PROVIDER_PRIMARY_API_KEY = "groq-key";
    process.env.MCP_PROVIDER_PRIMARY_MODEL = "llama-3.3-70b-versatile";
    process.env.MCP_PROVIDER_CHAIN2 = "cerebras";
    process.env.MCP_PROVIDER_CHAIN2_BASE_URL = "https://api.cerebras.ai/v1";
    process.env.MCP_PROVIDER_CHAIN2_API_KEY = "cerebras-key";
    process.env.MCP_PROVIDER_CHAIN2_MODEL = "llama-3.3-70b";
    const { providerChainConfig } = await import(`./provider-chain.js?chain-test=${Date.now()}`);
    assert(JSON.stringify(providerChainConfig().providers.map((p) => p.label)) === JSON.stringify(["groq", "cerebras"]), "journal provider chain should preserve order");
    for (const k of Object.keys(process.env)) if (k.startsWith("MCP_PROVIDER_")) delete process.env[k];
    process.env.MCP_RERANK_API_KEY = "legacy-key";
    process.env.MCP_RERANK_MODEL = "legacy-model";
    assert(providerChainConfig().providers[0].label === "legacy", "legacy fallback should work");
    process.env = old;
  });

  it("lists expected tools", async () => {
    const tools = await client.listTools();
    for (const t of ["journal_log", "journal_handoff", "journal_resume", "journal_timeline", "journal_search", "journal_clear_handoff"])
      assert(tools.includes(t), `missing ${t}`);
  });

  it("logs entries", async () => {
    const r1 = await client.callTool("journal_log", { dir: PROJ, title: "Set up auth", type: "done", body: "login + AuthService" });
    assertIncludes(r1.text, "Logged [done]");
    const r2 = await client.callTool("journal_log", { dir: PROJ, title: "Refresh undecided", type: "blocker" });
    assertIncludes(r2.text, "Logged [blocker]");
  });

  it("saves a handoff", async () => {
    const r = await client.callTool("journal_handoff", {
      dir: PROJ, summary: "Auth scaffolding done; wiring refresh next.",
      next_steps: ["Implement refresh", "Add tests"],
      open_questions: ["Cookie or header?"], active_files: ["src/auth.ts"],
    });
    assertIncludes(r.text, "Handoff saved");
    assertIncludes(r.text, "Next steps: 2");
  });

  it("resume returns handoff + recent entries", async () => {
    const r = await client.callTool("journal_resume", { dir: PROJ });
    assertIncludes(r.text, "Latest handoff");
    assertIncludes(r.text, "Implement refresh");
    assertIncludes(r.text, "Cookie or header?");
    assertIncludes(r.text, "Recent entries");
  });

  it("timeline filters by type", async () => {
    const r = await client.callTool("journal_timeline", { dir: PROJ, type: "blocker" });
    assertIncludes(r.text, "Refresh undecided");
    assert(!r.text.includes("Set up auth"), "should not include done entries when filtering blocker");
  });

  it("search finds entries by keyword (offline mode)", async () => {
    const r = await client.callTool("journal_search", { dir: PROJ, query: "auth login refresh" });
    assertIncludes(r.text, "[keyword]");
    assertIncludes(r.text, "Set up auth");
  });

  it("clears handoff", async () => {
    const r = await client.callTool("journal_clear_handoff", { dir: PROJ });
    assertIncludes(r.text, "Cleared handoff");
    const r2 = await client.callTool("journal_resume", { dir: PROJ });
    assert(!r2.text.includes("Latest handoff"), "handoff should be gone");
  });
});

await client.start();
const { fail } = await run();
await client.stop();
rmrf(STORE);
process.exit(fail > 0 ? 1 : 0);
