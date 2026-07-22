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

  it("startUiServer launches web dashboard server safely", async () => {
    const server = startUiServer(3456);
    assert(server !== null, "ui server started");
    await new Promise((resolve) => server.close(resolve));
  });
});

const { fail } = await run();
rmrf(TEST_DIR);
process.exit(fail > 0 ? 1 : 0);
