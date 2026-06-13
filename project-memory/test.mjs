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
