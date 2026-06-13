import { McpClient, describe, it, assert, assertIncludes, run, tmpDir, rmrf } from "../_testkit/harness.mjs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "server.js");
const STORE = tmpDir("cp-store-");
const PROJ = tmpDir("cp-proj-");

// seed project files
fs.mkdirSync(path.join(PROJ, "src"), { recursive: true });
fs.writeFileSync(path.join(PROJ, "src", "a.txt"), "original A\n");
fs.writeFileSync(path.join(PROJ, "README.md"), "# Title\n");

const client = new McpClient(SERVER, { CHECKPOINT_DIR: STORE });
let cpId = "";

describe("checkpoint", () => {
  it("lists expected tools", async () => {
    const tools = await client.listTools();
    for (const t of ["checkpoint_create", "checkpoint_list", "checkpoint_restore", "checkpoint_diff", "checkpoint_delete"])
      assert(tools.includes(t), `missing ${t}`);
  });

  it("creates a checkpoint", async () => {
    const r = await client.callTool("checkpoint_create", { dir: PROJ, label: "baseline" });
    assertIncludes(r.text, "Checkpoint");
    assertIncludes(r.text, "Files stored: 2");
    cpId = (r.text.match(/Checkpoint (\S+) created/) || [])[1] || "";
    assert(cpId, "could not parse checkpoint id");
  });

  it("diff detects add/modify/delete", async () => {
    fs.writeFileSync(path.join(PROJ, "src", "a.txt"), "CHANGED A\n");
    fs.writeFileSync(path.join(PROJ, "src", "new.txt"), "brand new\n");
    fs.rmSync(path.join(PROJ, "README.md"));
    const r = await client.callTool("checkpoint_diff", { dir: PROJ, id: cpId });
    assertIncludes(r.text, "Added (1)");
    assertIncludes(r.text, "src/new.txt");
    assertIncludes(r.text, "Modified (1)");
    assertIncludes(r.text, "src/a.txt");
    assertIncludes(r.text, "Deleted (1)");
    assertIncludes(r.text, "README.md");
  });

  it("restores with clean (revert + remove new)", async () => {
    const r = await client.callTool("checkpoint_restore", { dir: PROJ, id: cpId, clean: true });
    assertIncludes(r.text, "Restored 2 files");
    assert(fs.readFileSync(path.join(PROJ, "src", "a.txt"), "utf8").includes("original A"), "a.txt not reverted");
    assert(fs.existsSync(path.join(PROJ, "README.md")), "README not restored");
    assert(!fs.existsSync(path.join(PROJ, "src", "new.txt")), "new.txt not removed");
  });

  it("errors on unknown id", async () => {
    const r = await client.callTool("checkpoint_diff", { dir: PROJ, id: "nope-123" });
    assert(r.isError, "expected error flag");
    assertIncludes(r.text, "not found");
  });

  it("deletes the checkpoint", async () => {
    const r = await client.callTool("checkpoint_delete", { dir: PROJ, id: cpId });
    assertIncludes(r.text, "Deleted checkpoint");
    const r2 = await client.callTool("checkpoint_list", { dir: PROJ });
    assertIncludes(r2.text, "No checkpoints");
  });
});

await client.start();
const { fail } = await run();
await client.stop();
rmrf(STORE); rmrf(PROJ);
process.exit(fail > 0 ? 1 : 0);
