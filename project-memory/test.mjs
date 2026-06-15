import { McpClient, describe, it, assert, assertIncludes, run, tmpDir, rmrf } from "../_testkit/harness.mjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "server.js");
const VAULT = tmpDir("pm-");
const DEMO = "/tmp/pm-demo-project";

// Force keyword mode (no embedding key) so the suite is deterministic/offline.
const client = new McpClient(SERVER, { MEMORY_VAULT_DIR: VAULT, NINEROUTER_KEY: "", EMBED_KEY: "" });

let savedId = "";

describe("project-memory", () => {
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

  it("lists expected tools", async () => {
    const tools = await client.listTools();
    for (const t of ["memory_save", "memory_recall", "memory_list", "memory_get", "memory_delete", "memory_reindex"])
      assert(tools.includes(t), `missing ${t}`);
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
