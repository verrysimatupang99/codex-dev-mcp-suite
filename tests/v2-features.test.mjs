import { describe, it, assert, run, tmpDir, rmrf } from "../_testkit/harness.mjs";
import { broadcastSwarmEvent, getSwarmTimeline } from "../project-memory/swarm.js";
import { compressJournalEntries } from "../devjournal/compress.js";
import fs from "fs/promises";
import path from "path";

const TEST_VAULT = tmpDir("swarm-vault-");
const TEST_JOURNAL = tmpDir("compress-journal-");

describe("v2.0.0 peak intelligence features", () => {
  it("swarm broadcasts and retrieves events correctly", async () => {
    const evt1 = await broadcastSwarmEvent(TEST_VAULT, {
      eventType: "finding",
      topic: "auth refactor",
      payload: { note: "jwt token check refactored" },
      agentName: "hermes-agent",
    });

    const evt2 = await broadcastSwarmEvent(TEST_VAULT, {
      eventType: "bug",
      topic: "db pool timeout",
      payload: { maxConnections: 10 },
      agentName: "antigravity-agent",
    });

    assert(evt1.id.startsWith("evt_"), "event1 id format");
    assert(evt2.id.startsWith("evt_"), "event2 id format");

    const timeline = await getSwarmTimeline(TEST_VAULT, { limit: 10 });
    assert(timeline.length === 2, `expected 2 events, got ${timeline.length}`);
    assert(timeline[0].topic === "db pool timeout" || timeline[1].topic === "db pool timeout");

    const filtered = await getSwarmTimeline(TEST_VAULT, { eventType: "bug" });
    assert(filtered.length === 1, `expected 1 bug event, got ${filtered.length}`);
    assert(filtered[0].topic === "db pool timeout");
  });

  it("compressJournalEntries summarizes verbose logs into dense snapshot", async () => {
    const slug = "test-project";
    const projDir = path.join(TEST_JOURNAL, slug);
    await fs.mkdir(projDir, { recursive: true });

    const logFile = path.join(projDir, "log.jsonl");
    const logs = [
      JSON.stringify({ timestamp: new Date().toISOString(), entryType: "decision", text: "Switched to PostgreSQL for multi-tenant support", file: "prisma/schema.prisma" }),
      JSON.stringify({ timestamp: new Date().toISOString(), entryType: "blocker", text: "Outbound port 22 blocked by office Wi-Fi", file: "deploy.sh" }),
      JSON.stringify({ timestamp: new Date().toISOString(), entryType: "note", text: "Tailscale P2P fallback verified working", file: "docs/tailscale.md" }),
    ];
    await fs.writeFile(logFile, logs.join("\n") + "\n");

    const res = await compressJournalEntries(TEST_JOURNAL, slug, { limit: 10 });
    assert(res.entriesCount === 3, `entries count should be 3, got ${res.entriesCount}`);
    assert(res.compressedText.includes("Key Decisions"), "includes Key Decisions section");
    assert(res.compressedText.includes("PostgreSQL"), "includes decision text");
    assert(res.compressedText.includes("Outbound port 22"), "includes blocker text");
  });
});

const { fail } = await run();
rmrf(TEST_VAULT);
rmrf(TEST_JOURNAL);
process.exit(fail > 0 ? 1 : 0);
