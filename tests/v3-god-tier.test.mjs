import fs from "fs/promises";
import path from "path";
import { describe, it, assert, run, tmpDir, rmrf } from "../_testkit/harness.mjs";
import { runAutoIndexer } from "../project-memory/auto-indexer.js";
import { startUiServer } from "../lib/ui-server.js";

const TEST_DIR = tmpDir("v3-god-tier-");

describe("v3.0.0 god-tier autonomous agent OS features", () => {
  it("runAutoIndexer inspects project git & mtime state", async () => {
    const res = await runAutoIndexer(TEST_DIR, { dryRun: true });
    assert(res.projectDir !== null, "returns projectDir");
    assert(typeof res.summaryText === "string", "returns summaryText");
    assert(res.summaryText.includes("Auto-Derived Knowledge Snapshot"), "includes header");
  });

  it("runAutoIndexer watchdog scans session logs and extracts architectural decisions", async () => {
    const sessionDir = path.join(TEST_DIR, ".codex");
    await fs.mkdir(sessionDir, { recursive: true });
    const logFile = path.join(sessionDir, "history.jsonl");
    const logData = [
      JSON.stringify({ type: "USER_INPUT", content: "Mengapa kita memilih migrasi dari bot V1 ke V2 di arsitektur baru ini?" }),
      JSON.stringify({ type: "PLANNER_RESPONSE", content: "Keputusan arsitektur: Trading bot V1 monolith memiliki latency tinggi, sedangkan V2 berbasis microservices dengan latency di bawah 10ms." }),
    ].join("\n");
    await fs.writeFile(logFile, logData, "utf8");

    const res = await runAutoIndexer(TEST_DIR, { dryRun: false, scanSessions: true });
    assert(res.sessionDecisions.length > 0, "detects session decisions from logs");
    assert(res.summaryText.includes("Session Conversation Digest"), "summary includes watchdog digest section");
    assert(res.notesCreated.length > 0, "generates individual note for significant architectural decision");
    assert(res.notesCreated[0].title.includes("Session Digest"), "note title formatted correctly");
  });

  it("startUiServer launches web dashboard server safely", async () => {
    const server = startUiServer(3456);
    assert(server !== null, "ui server started");
    await new Promise((resolve) => server.close(resolve));
  });
});

const { fail } = await run();
rmrf(TEST_DIR);
process.exit(fail > 0 ? 1 : 0);
