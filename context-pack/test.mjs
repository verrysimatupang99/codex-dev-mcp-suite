import { McpClient, describe, it, assert, assertIncludes, run, tmpDir, rmrf } from "../_testkit/harness.mjs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "server.js");
const PROJ = tmpDir("ctx-proj-");

fs.mkdirSync(path.join(PROJ, "src"), { recursive: true });
fs.writeFileSync(path.join(PROJ, "package.json"), JSON.stringify({
  name: "sample", version: "1.0.0",
  scripts: { dev: "vite", test: "vitest" },
  dependencies: { react: "^18.0.0", next: "^14.0.0" },
}, null, 2));
fs.writeFileSync(path.join(PROJ, "README.md"), "# Sample Project\nDemo app.\n## Setup\nnpm install\n");
fs.writeFileSync(path.join(PROJ, "src", "auth.ts"),
  "export function login(user: string) { return true; }\nexport class AuthService { verify() {} }\nfunction helperInternal() {}\n");

const client = new McpClient(SERVER, {});

describe("context-pack", () => {
  it("lists expected tools", async () => {
    const tools = await client.listTools();
    for (const t of ["pack_overview", "pack_tree", "pack_outline", "pack_search", "pack_audit", "pack_impact", "pack_guard"])
      assert(tools.includes(t), `missing ${t}`);
  });

  it("overview detects stack + scripts + readme", async () => {
    const r = await client.callTool("pack_overview", { dir: PROJ });
    assertIncludes(r.text, "Next.js");
    assertIncludes(r.text, "React");
    assertIncludes(r.text, "dev: vite");
    assertIncludes(r.text, "Sample Project");
  });

  it("tree shows dirs and files", async () => {
    const r = await client.callTool("pack_tree", { dir: PROJ, max_depth: 3 });
    assertIncludes(r.text, "src/");
    assertIncludes(r.text, "auth.ts");
  });

  it("outline extracts symbols", async () => {
    const r = await client.callTool("pack_outline", { dir: PROJ, file: "src/auth.ts" });
    assertIncludes(r.text, "login");
    assertIncludes(r.text, "AuthService");
    assertIncludes(r.text, "helperInternal");
  });

  it("outline errors on missing file", async () => {
    const r = await client.callTool("pack_outline", { dir: PROJ, file: "does/not/exist.ts" });
    assert(r.isError, "expected error");
    assertIncludes(r.text, "File not found");
  });

  it("search matches by path substring", async () => {
    const r = await client.callTool("pack_search", { dir: PROJ, query: "auth" });
    assertIncludes(r.text, "src/auth.ts");
  });

  it("audit flags missing .gitignore or sensitive file", async () => {
    const r = await client.callTool("pack_audit", { dir: PROJ });
    assertIncludes(r.text, "Audit:");
  });

  it("impact calculates caller blast radius", async () => {
    const r = await client.callTool("pack_impact", { dir: PROJ, targetFile: "src/auth.ts" });
    assertIncludes(r.text, "Impact Blast-Radius:");
    assertIncludes(r.text, "src/auth.ts");
  });

  it("guard runs toolchain checks", async () => {
    const r = await client.callTool("pack_guard", { dir: PROJ });
    assertIncludes(r.text, "Guard Pre-flight Diagnostics");
  });
});

await client.start();
const { fail } = await run();
await client.stop();
rmrf(PROJ);
process.exit(fail > 0 ? 1 : 0);
