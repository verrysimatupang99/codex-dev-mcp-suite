
import { isCloudflareURL, embeddingConfig } from "./embedding.js";

describe("embedding endpoint detection", () => {
  it("isCloudflareURL detects CF Workers AI URLs", () => {
    assert(isCloudflareURL("https://api.cloudflare.com/client/v4/accounts/abc/ai/run/"));
    assert(isCloudflareURL("https://api.cloudflare.com/client/v4/accounts/59bf6ed6/ai/run/"));
  });

  it("isCloudflareURL returns false for OpenAI-compatible URLs", () => {
    assertEqual(isCloudflareURL("https://api.openai.com/v1"), false);
    assertEqual(isCloudflareURL("https://api.groq.com/openai/v1"), false);
    assertEqual(isCloudflareURL("http://localhost:11434/v1"), false);
    assertEqual(isCloudflareURL(""), false);
  });

  it("embeddingConfig reports endpoint type based on base URL", () => {
    const cf = embeddingConfig.__esModule ? null : null; // noop
    // Set env temporarily to verify config
    const orig = process.env.MCP_EMBED_BASE_URL;
    process.env.MCP_EMBED_BASE_URL = "https://api.cloudflare.com/client/v4/accounts/x/ai/run/";
    process.env.MCP_EMBED_API_KEY = "fake";
    const cfg = embeddingConfig();
    assertEqual(cfg.endpoint, "cloudflare");
    process.env.MCP_EMBED_BASE_URL = orig;
    process.env.MCP_EMBED_API_KEY = "";
  });
});

import { McpClient, describe, it, assert, assertEqual, assertIncludes, run, tmpDir, rmrf } from "../_testkit/harness.mjs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "server.js");
const BIN = path.join(__dirname, "..", "bin", "project-memory.mjs");
const VAULT = tmpDir("pm-");
const DEMO = "/tmp/pm-demo-project";

// Force keyword mode (no embedding key) so the suite is deterministic/offline.
const client = new McpClient(SERVER, { MEMORY_VAULT_DIR: VAULT, NINEROUTER_KEY: "", EMBED_KEY: "" });

let savedId = "";

describe("project-memory", () => {
  it("parses wiki links from note bodies", async () => {
    const mod = await import("./graph.js");
    const links = mod.extractWikiLinks("See [[abc123]] and [[proj:Design Note]] and [[JWT Flow]]");
    assertEqual(JSON.stringify(links), JSON.stringify([
      { raw: "[[abc123]]", ref: "abc123", project: null, kind: "id" },
      { raw: "[[proj:Design Note]]", ref: "Design Note", project: "proj", kind: "title" },
      { raw: "[[JWT Flow]]", ref: "JWT Flow", project: null, kind: "title" },
    ]));
  });

  it("derives note links and id backlinks", async () => {
    const mod = await import("./graph.js");
    const index = {
      notes: {
        abc123: { id: "abc123", title: "Target", file: "abc123.md" },
        def456: { id: "def456", title: "Source", file: "def456.md" },
      },
    };
    const bodies = {
      "abc123.md": "Target body",
      "def456.md": "See [[abc123]] and [[Other Title]] and [[remote:Cross Project]]",
    };

    const result = await mod.ensureGraphState({
      index,
      projectDir: "/tmp/project-memory-graph-test",
      noteLoader: async (_projectDir, file) => bodies[file],
    });

    assertEqual(result.changed, true);
    assertEqual(JSON.stringify(result.index.notes.def456.links), JSON.stringify([
      { raw: "[[abc123]]", ref: "abc123", project: null, kind: "id" },
      { raw: "[[Other Title]]", ref: "Other Title", project: null, kind: "title" },
      { raw: "[[remote:Cross Project]]", ref: "Cross Project", project: "remote", kind: "title" },
    ]));
    assertEqual(JSON.stringify(result.index.notes.abc123.backlinks), JSON.stringify([{ id: "def456", title: "Source" }]));
    assertEqual(result.index.notes.def456.backlinks, undefined);
  });

  it("loads note body without frontmatter", async () => {
    const mod = await import("./graph.js");
    const tmp = tmpDir("pm-graph-body-");
    try {
      fs.writeFileSync(path.join(tmp, "note.md"), "---\ntitle: \"Graph Note\"\n---\n\nBody with [[abc123]]");
      const body = await mod.loadNoteBody(tmp, "note.md");
      assertEqual(body.trim(), "Body with [[abc123]]");
    } finally {
      rmrf(tmp);
    }
  });

  it("resolves links by id and title within a vault", async () => {
    const mod = await import("./graph.js");
    const vaultRoot = tmpDir("pm-graph-vault-");
    try {
      const slug = "demo-slug";
      fs.mkdirSync(path.join(vaultRoot, slug), { recursive: true });
      fs.writeFileSync(path.join(vaultRoot, slug, "index.json"), JSON.stringify({
        notes: {
          abc123: { id: "abc123", title: "Target" },
          def456: { id: "def456", title: "Design Note" },
        },
      }));
      const byId = await mod.resolveLink({ vaultRoot, currentSlug: slug, ref: "abc123", project: null, kind: "id" });
      const byTitle = await mod.resolveLink({ vaultRoot, currentSlug: slug, ref: "Design Note", project: null, kind: "title" });
      assertEqual(byId.status, "resolved");
      assertEqual(byId.match.id, "abc123");
      assertEqual(byTitle.status, "resolved");
      assertEqual(byTitle.match.id, "def456");
    } finally {
      rmrf(vaultRoot);
    }
  });

  it("parses deterministic fallback true values", async () => {
    const old = { ...process.env };
    const { deterministicEnabled } = await import(`./env.js?det-test=${Date.now()}`);
    for (const v of ["true", "1", "yes", "on", "TRUE", "On"]) {
      process.env.MCP_DETERMINISTIC_FALLBACK = v;
      assert(deterministicEnabled(), `${v} should enable deterministic fallback`);
    }
    process.env.MCP_DETERMINISTIC_FALLBACK = "0";
    assert(!deterministicEnabled(), "0 should not enable deterministic fallback");
    process.env = old;
  });

  it("prefers neutral MCP embedding env aliases", async () => {
    const old = { ...process.env };
    process.env.MCP_EMBED_BASE_URL = "http://embed.example/v1";
    process.env.MCP_EMBED_API_KEY = "embed-key";
    process.env.MCP_EMBED_MODEL = "embed-model";
    process.env.NINEROUTER_URL = "http://legacy.example";
    process.env.NINEROUTER_KEY = "legacy-key";
    process.env.EMBED_MODEL = "legacy-model";
    const { embeddingConfig } = await import(`./embedding.js?alias-test=${Date.now()}`);
    const cfg = embeddingConfig();
    assert(cfg.base === "http://embed.example/v1", "MCP_EMBED_BASE_URL should win");
    assert(cfg.model === "embed-model", "MCP_EMBED_MODEL should win");
    assert(cfg.enabled === true, "MCP_EMBED_API_KEY should enable embeddings");
    process.env = old;
  });

  it("prefers neutral MCP rerank env aliases", async () => {
    const old = { ...process.env };
    process.env.MCP_RERANK_BASE_URL = "http://rerank.example/v1";
    process.env.MCP_RERANK_API_KEY = "rerank-key";
    process.env.MCP_RERANK_MODEL = "rerank-model";
    process.env.NINEROUTER_URL = "http://legacy.example";
    process.env.NINEROUTER_KEY = "legacy-key";
    process.env.RERANK_MODEL = "legacy-model";
    const { rerankConfig } = await import(`./rerank.js?alias-test=${Date.now()}`);
    const cfg = rerankConfig();
    assert(cfg.base === "http://rerank.example/v1", "MCP_RERANK_BASE_URL should win");
    assert(cfg.model === "rerank-model", "MCP_RERANK_MODEL should win");
    assert(cfg.enabled === true, "MCP_RERANK_API_KEY should enable rerank");
    process.env = old;
  });

  it("builds numbered provider chain in order", async () => {
    const old = { ...process.env };
    process.env = { ...old };
    for (const k of Object.keys(process.env)) if (k.startsWith("MCP_PROVIDER_") || k.startsWith("MCP_RERANK_") || k.startsWith("MCP_LLM_") || k === "RERANK_ENABLED" || k === "MCP_DETERMINISTIC_FALLBACK") delete process.env[k];
    process.env.MCP_PROVIDER_PRIMARY = "groq";
    process.env.MCP_PROVIDER_PRIMARY_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.MCP_PROVIDER_PRIMARY_API_KEY = "groq-key";
    process.env.MCP_PROVIDER_PRIMARY_MODEL = "llama-3.3-70b-versatile";
    process.env.MCP_PROVIDER_CHAIN3 = "openrouter";
    process.env.MCP_PROVIDER_CHAIN3_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.MCP_PROVIDER_CHAIN3_API_KEY = "openrouter-key";
    process.env.MCP_PROVIDER_CHAIN3_MODEL = "openai/gpt-4o-mini";
    process.env.MCP_PROVIDER_CHAIN2 = "cerebras";
    process.env.MCP_PROVIDER_CHAIN2_BASE_URL = "https://api.cerebras.ai/v1";
    process.env.MCP_PROVIDER_CHAIN2_API_KEY = "cerebras-key";
    process.env.MCP_PROVIDER_CHAIN2_MODEL = "llama-3.3-70b";
    process.env.MCP_PROVIDER_CHAIN4 = "custom";
    process.env.MCP_PROVIDER_CHAIN4_BASE_URL = "https://custom.example/v1";
    process.env.MCP_PROVIDER_CHAIN4_API_KEY = "custom-key";
    process.env.MCP_PROVIDER_CHAIN4_MODEL = "custom-model";
    const { providerChainConfig } = await import(`./provider-chain.js?chain-test=${Date.now()}`);
    const cfg = providerChainConfig();
    assert(cfg.enabled, "provider chain should be enabled");
    assert(JSON.stringify(cfg.providers.map((p) => p.label)) === JSON.stringify(["groq", "cerebras", "openrouter", "custom"]), "providers should be primary then numeric chain order");
    process.env = old;
  });

  it("skips incomplete provider slots and honors deterministic disable", async () => {
    const old = { ...process.env };
    process.env = { ...old };
    for (const k of Object.keys(process.env)) if (k.startsWith("MCP_PROVIDER_") || k.startsWith("MCP_RERANK_") || k.startsWith("MCP_LLM_") || k === "RERANK_ENABLED" || k === "MCP_DETERMINISTIC_FALLBACK") delete process.env[k];
    process.env.MCP_PROVIDER_PRIMARY = "groq";
    process.env.MCP_PROVIDER_PRIMARY_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.MCP_PROVIDER_PRIMARY_API_KEY = "groq-key";
    process.env.MCP_PROVIDER_CHAIN2 = "missing-model";
    process.env.MCP_PROVIDER_CHAIN2_BASE_URL = "https://bad.example/v1";
    process.env.MCP_PROVIDER_CHAIN2_API_KEY = "bad-key";
    const mod = await import(`./provider-chain.js?skip-test=${Date.now()}`);
    assert(mod.providerChainConfig().enabled === false, "incomplete primary should not enable chain");
    process.env.MCP_RERANK_API_KEY = "legacy-key";
    process.env.MCP_RERANK_MODEL = "legacy-model";
    assert(mod.providerChainConfig().providers[0].label === "legacy", "legacy fallback should work when numbered slots incomplete");
    process.env.MCP_DETERMINISTIC_FALLBACK = "true";
    assert(mod.providerChainConfig().enabled === false, "deterministic should disable providers");
    process.env = old;
  });

  it("diagnostics flags incomplete slot and redacts keys", async () => {
    const old = { ...process.env };
    process.env = { ...old };
    for (const k of Object.keys(process.env)) if (k.startsWith("MCP_PROVIDER_") || k.startsWith("MCP_RERANK_") || k.startsWith("MCP_LLM_") || k === "RERANK_ENABLED" || k === "MCP_DETERMINISTIC_FALLBACK") delete process.env[k];
    process.env.MCP_PROVIDER_PRIMARY = "groq";
    process.env.MCP_PROVIDER_PRIMARY_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.MCP_PROVIDER_PRIMARY_API_KEY = "supersecretvalue";
    process.env.MCP_PROVIDER_PRIMARY_MODEL = "llama-3.3-70b-versatile";
    process.env.MCP_PROVIDER_CHAIN2 = "incomplete";
    process.env.MCP_PROVIDER_CHAIN2_BASE_URL = "https://bad.example/v1";
    const { providerChainDiagnostics } = await import(`./provider-chain.js?diag-test=${Date.now()}`);
    const d = providerChainDiagnostics();
    assert(d.providers.length === 1, "only complete provider should be active");
    assert(d.providers[0].apiKey === "set (16 chars)", "api key should be redacted");
    assert(JSON.stringify(d).includes("supersecretvalue") === false, "diagnostics must not contain raw key");
    assert(d.issues.some((i) => i.prefix === "MCP_PROVIDER_CHAIN2"), "incomplete slot should be reported");
    process.env = old;
  });

  it("cooldown helpers gate failing providers", async () => {
    const { recordOutcome, isCoolingDown, _resetCooldowns } = await import(`./provider-chain.js?cool-test=${Date.now()}`);
    _resetCooldowns();
    const key = "groq|https://api.groq.com/openai/v1|m";
    const t0 = 1_000_000;
    assert(isCoolingDown(key, t0) === false, "fresh provider should not be cooling down");
    recordOutcome(key, false, t0);
    assert(isCoolingDown(key, t0 + 1000) === true, "failed provider should cool down");
    assert(isCoolingDown(key, t0 + 60001) === false, "cooldown should expire after window");
    recordOutcome(key, false, t0 + 60002);
    recordOutcome(key, true, t0 + 60003);
    assert(isCoolingDown(key, t0 + 60004) === false, "success should clear cooldown");
  });

  it("bin --version prints version and --doctor redacts keys", () => {
    const ver = spawnSync("node", [BIN, "--version"], { encoding: "utf8" });
    assert(/^\d+\.\d+\.\d+/.test(ver.stdout.trim()), `unexpected version output: ${ver.stdout}`);
    const doc = spawnSync("node", [BIN, "--doctor"], { encoding: "utf8", env: { ...process.env, MCP_LLM_API_KEY: "supersecretvalue" } });
    assert(doc.stdout.includes("keys redacted"), "doctor should mark keys redacted");
    assert(doc.stdout.includes("supersecretvalue") === false, "doctor must not print raw key");
  });

  it("lists expected tools", async () => {
    const tools = await client.listTools();
    for (const t of ["memory_save", "memory_recall", "memory_list", "memory_get", "memory_delete", "memory_reindex", "memory_stats"])
      assert(tools.includes(t), `missing ${t}`);
  });

  it("memory_stats returns human text by default", async () => {
    // point at a custom tmp root so test is hermetic
    const tmpRoot = tmpDir("pm-stats-");
    fs.mkdirSync(path.join(tmpRoot, "vault", "demo", "notes"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "vault", "demo", "notes", "n1.md"), "# hi");
    const r = await client.callTool("memory_stats", { root: tmpRoot });
    assertIncludes(r.text, "Dev MCP Suite");
    assertIncludes(r.text, "demo");
    rmrf(tmpRoot);
  });

  it("memory_stats returns JSON when json=true", async () => {
    const tmpRoot = tmpDir("pm-stats-json-");
    fs.mkdirSync(path.join(tmpRoot, "vault", "demo2", "notes"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "vault", "demo2", "notes", "n.md"), "# hi");
    const r = await client.callTool("memory_stats", { root: tmpRoot, json: true });
    const j = JSON.parse(r.text);
    assert(j.totals, "expected totals in JSON output");
    assertEqual(j.totals.notes, 1);
    rmrf(tmpRoot);
  });

  it("saves a note (keyword mode without embeddings)", async () => {
    const r = await client.callTool("memory_save", {
      dir: DEMO, title: "JWT login flow",
      content: "login() issues JWT; refresh token in httpOnly cookie; clock skew bug on verify.",
      tags: ["auth", "jwt"], kind: "decision",
    });
    assertIncludes(r.text, "Saved note");
    assertIncludes(r.text, "keyword-only");
    savedId = (r.text.match(/Saved note (\S+)/) || [])[1] || "";
    assert(savedId, "could not parse note id");
  });

  it("recalls by keyword and tags mode label", async () => {
    const r = await client.callTool("memory_recall", { dir: DEMO, query: "jwt auth cookie" });
    assertIncludes(r.text, "[keyword]");
    assertIncludes(r.text, "JWT login flow");
  });

  it("labels recall as deterministic when hard no-network mode is enabled", async () => {
    const detStore = tmpDir("pm-det-");
    const detClient = new McpClient(SERVER, { MEMORY_VAULT_DIR: detStore, MCP_DETERMINISTIC_FALLBACK: "true", MCP_LLM_API_KEY: "should-not-be-used" });
    await detClient.start();
    try {
      await detClient.callTool("memory_save", {
        dir: "/tmp/pm-det-project", title: "Local only mode",
        content: "deterministic fallback uses local keyword scoring only",
        tags: ["local"], kind: "note",
      });
      const r = await detClient.callTool("memory_recall", { dir: "/tmp/pm-det-project", query: "deterministic keyword" });
      assertIncludes(r.text, "[deterministic]");
      const ri = await detClient.callTool("memory_reindex", { dir: "/tmp/pm-det-project" });
      assertIncludes(ri.text, "deterministic no-network mode");
    } finally {
      await detClient.stop();
      rmrf(detStore);
    }
  });

  it("memory_recall mode=keyword skips semantic", async () => {
    // Default client has no embed key, so even without mode arg, recall is [keyword].
    // Here we explicitly ask for keyword mode; same outcome.
    const r = await client.callTool("memory_recall", { dir: DEMO, query: "jwt", mode: "keyword" });
    assertIncludes(r.text, "[keyword]");
  });

  it("memory_recall mode=semantic without embed key returns isError", async () => {
    const r = await client.callTool("memory_recall", { dir: DEMO, query: "jwt", mode: "semantic" });
    assert(r.isError, "expected isError when semantic requested but no embed key");
    assertIncludes(r.text, "no embeddings available");
  });

  it("memory_recall mode=auto (default) annotates rerank when active", async () => {
    // This client has no rerank key either, so no +rerank suffix. Just verify no crash and recall succeeds.
    const r = await client.callTool("memory_recall", { dir: DEMO, query: "jwt" });
    // Should not contain "+rerank" since rerank is disabled
    assert(!r.text.includes("+rerank"), "should not have +rerank when rerank disabled");
  });

  it("memory_recall defaults to mode=auto when arg omitted", async () => {
    const r = await client.callTool("memory_recall", { dir: DEMO, query: "jwt" });
    assertIncludes(r.text, "[keyword]"); // because no embed key in this test client
  });

  it("returns no-match gracefully", async () => {
    const r = await client.callTool("memory_recall", { dir: DEMO, query: "kubernetes helm chart xyzzy" });
    assertIncludes(r.text, "No relevant memories");
  });

  it("lists saved notes", async () => {
    const r = await client.callTool("memory_list", { dir: DEMO });
    assertIncludes(r.text, "JWT login flow");
  });

  it("gets full note by id", async () => {
    const r = await client.callTool("memory_get", { dir: DEMO, id: savedId });
    assertIncludes(r.text, "httpOnly cookie");
  });

  it("reindex reports gracefully without embeddings", async () => {
    const r = await client.callTool("memory_reindex", { dir: DEMO });
    assertIncludes(r.text, "failed");
  });

  it("deletes a note", async () => {
    const r = await client.callTool("memory_delete", { dir: DEMO, id: savedId });
    assertIncludes(r.text, "Deleted note");
    const r2 = await client.callTool("memory_list", { dir: DEMO });
    assertIncludes(r2.text, "No memories");
  });
});

await client.start();
const { fail } = await run();
await client.stop();
rmrf(VAULT);
process.exit(fail > 0 ? 1 : 0);
