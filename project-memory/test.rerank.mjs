// Optional online test: LLM rerank via 9router Kiro. Skips cleanly if offline.
import { McpClient, describe, it, assert, assertIncludes, run, tmpDir, rmrf } from "../_testkit/harness.mjs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "server.js");
const KEY = process.env.NINEROUTER_KEY || process.env.RERANK_KEY || "";
const URL_BASE = "http://localhost:20128";

function ping() {
  return new Promise((resolve) => {
    const req = http.request(URL_BASE + "/v1/models", { method: "GET", timeout: 4000, headers: { Authorization: `Bearer ${KEY}` } }, (r) => { r.resume(); resolve(r.statusCode === 200); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

if (!KEY) { console.log("  ⚠ rerank test skipped (no NINEROUTER_KEY in env)"); process.exit(0); }
const online = await ping();
if (!online) {
  console.log("  ⚠ rerank test skipped (9router not reachable)");
  process.exit(0);
}

const VAULT = tmpDir("pm-rr-");
const DEMO = "/tmp/pm-rr-demo";
const env = { MEMORY_VAULT_DIR: VAULT, NINEROUTER_URL: URL_BASE, NINEROUTER_KEY: KEY, EMBED_KEY: "", RERANK_MODEL: "kr/claude-haiku-4.5", RERANK_TIMEOUT_MS: "40000" };
const client = new McpClient(SERVER, env);

describe("project-memory (rerank/online)", () => {
  it("seeds distinct notes", async () => {
    await client.callTool("memory_save", { dir: DEMO, title: "JWT auth flow", content: "login issues JWT; refresh token stored in httpOnly cookie", tags: ["auth"] });
    await client.callTool("memory_save", { dir: DEMO, title: "Dark mode toggle", content: "CSS variables and localStorage for theme switching", tags: ["ui"] });
    await client.callTool("memory_save", { dir: DEMO, title: "Nginx docker setup", content: "Dockerfile and compose for nginx reverse proxy", tags: ["infra"] });
    const r = await client.callTool("memory_list", { dir: DEMO });
    assertIncludes(r.text, "(3)");
  });

  it("reranks a semantic query to the auth note (no keyword overlap)", async () => {
    const r = await client.callTool("memory_recall", { dir: DEMO, query: "how do users sign in securely with tokens", limit: 1 }, 60000);
    assertIncludes(r.text, "[rerank]");
    assertIncludes(r.text, "JWT auth flow");
  });
});

await client.start();
const { fail } = await run();
await client.stop();
rmrf(VAULT);
process.exit(fail > 0 ? 1 : 0);
