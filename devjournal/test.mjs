import { McpClient, describe, it, assert, assertIncludes, run, tmpDir, rmrf } from "../_testkit/harness.mjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "server.js");
const STORE = tmpDir("jrnl-");
const PROJ = "/tmp/jrnl-demo-project";

const client = new McpClient(SERVER, { JOURNAL_DIR: STORE });

describe("devjournal", () => {
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
