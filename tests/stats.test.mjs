/**
 * Tests for the stats CLI library.
 * Run directly: node tests/stats.test.mjs
 * Picked up by run-tests.mjs.
 */
import {
  describe, it, assert, assertEqual, assertIncludes, run, tmpDir, rmrf,
} from "../_testkit/harness.mjs";
import fs from "fs";
import path from "path";
import { computeStats, formatText, formatJson } from "../lib/stats.js";

// ---- fixture helpers ----

function makeVaultSlug(vaultRoot, slug, { notes = 0, lastNoteTs = null } = {}) {
  const slugDir = path.join(vaultRoot, slug);
  fs.mkdirSync(path.join(slugDir, "notes"), { recursive: true });
  fs.writeFileSync(path.join(slugDir, "index.json"), "{}");
  for (let i = 0; i < notes; i++) {
    const ts = lastNoteTs || `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`;
    fs.writeFileSync(
      path.join(slugDir, "notes", `note-${i}.md`),
      `---
id: "${slug}-${i}"
created: "${ts}"
---
# Note ${i}
body`,
    );
  }
  return slugDir;
}

function makeJournalSlug(journalRoot, slug, { entries = 0, baseTs = "2026-06-01T00:00:00.000Z", handoff = false } = {}) {
  const slugDir = path.join(journalRoot, slug);
  fs.mkdirSync(slugDir, { recursive: true });
  if (entries > 0) {
    const lines = [];
    const start = new Date(baseTs).getTime();
    for (let i = 0; i < entries; i++) {
      const ts = new Date(start + i * 60_000).toISOString();
      lines.push(JSON.stringify({ ts, type: "note", title: `entry ${i}`, body: "x" }));
    }
    fs.writeFileSync(path.join(slugDir, "journal.jsonl"), lines.join("\n") + "\n");
  }
  if (handoff) {
    fs.writeFileSync(
      path.join(slugDir, "handoff.json"),
      JSON.stringify({ ts: baseTs, summary: "x", next_steps: [], active_files: [] }),
    );
  }
  if (!entries && !handoff) {
    fs.writeFileSync(path.join(slugDir, "journal.md"), "# Journal\n");
  }
  return slugDir;
}

function makeCheckpointSlug(cpRoot, slug, { checkpoints = 0, baseTs = "2026-06-01T00:00:00Z" } = {}) {
  const slugDir = path.join(cpRoot, slug);
  fs.mkdirSync(path.join(slugDir, "snapshots"), { recursive: true });
  const manifest = { project: slug, checkpoints: {} };
  for (let i = 0; i < checkpoints; i++) {
    const id = `2026-06-${String(i + 1).padStart(2, "0")}T0000-${i}`;
    fs.mkdirSync(path.join(slugDir, "snapshots", id), { recursive: true });
    fs.writeFileSync(path.join(slugDir, "snapshots", id, "manifest.json"), "{}");
    manifest.checkpoints[id] = { id, created: `${baseTs.slice(0, 10)}T00:0${i}:00Z` };
  }
  fs.writeFileSync(path.join(slugDir, "manifest.json"), JSON.stringify(manifest));
  return slugDir;
}

function setupRoot(opts = {}) {
  const root = tmpDir("stats-test-");
  const vault = path.join(root, "vault");
  const journal = path.join(root, "journal");
  const checkpoints = path.join(root, "checkpoints");
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(journal, { recursive: true });
  fs.mkdirSync(checkpoints, { recursive: true });

  const { projects = [], tempSlugs = [] } = opts;
  for (const slug of tempSlugs) makeVaultSlug(vault, slug);
  for (const p of projects) {
    if (p.notes) makeVaultSlug(vault, p.slug, { notes: p.notes });
    if (p.journal) makeJournalSlug(journal, p.slug, p.journal);
    if (p.checkpoints) makeCheckpointSlug(checkpoints, p.slug, { checkpoints: p.checkpoints });
  }
  return { root, vault, journal, checkpoints };
}

// ---- tests ----

describe("stats lib", () => {
  it("returns zeros for empty storage", () => {
    const { root } = setupRoot();
    const s = computeStats({ root });
    assertEqual(s.totals.notes, 0);
    assertEqual(s.totals.journalProjects, 0);
    assertEqual(s.totals.checkpoints, 0);
    assertEqual(s.projectCount, 0);
    rmrf(root);
  });

  it("counts notes and groups by slug across stores", () => {
    const { root } = setupRoot({
      projects: [
        { slug: "alpha", notes: 5, journal: { entries: 3 }, checkpoints: 2 },
        { slug: "beta", notes: 1 },
      ],
    });
    const s = computeStats({ root });
    assertEqual(s.totals.notes, 6);
    assertEqual(s.totals.journalProjects, 1);
    assertEqual(s.totals.checkpoints, 2);
    const alpha = s.perProject.find((p) => p.slug === "alpha");
    const beta = s.perProject.find((p) => p.slug === "beta");
    assertEqual(alpha.notes, 5);
    assertEqual(alpha.journalEntries, 3);
    assertEqual(alpha.checkpoints, 2);
    assertEqual(beta.notes, 1);
    assertEqual(beta.journalEntries, 0);
    assertEqual(beta.checkpoints, 0);
    rmrf(root);
  });

  it("flags temp slugs (tmp.*) for cleanup visibility", () => {
    const { root } = setupRoot({
      tempSlugs: ["tmp.abc-12345", "tmp.xyz-67890"],
      projects: [{ slug: "real", notes: 2 }],
    });
    const s = computeStats({ root });
    assertEqual(s.tempSlugs.length, 2);
    assert(s.tempSlugs.includes("tmp.abc-12345"), "should include tmp slug");
    assert(!s.tempSlugs.includes("real"), "real slug should not be temp");
    rmrf(root);
  });

  it("topByNotes sorts descending and caps at limit", () => {
    const { root } = setupRoot({
      projects: [
        { slug: "small", notes: 1 },
        { slug: "big", notes: 10 },
        { slug: "mid", notes: 5 },
        { slug: "tiny", notes: 2 },
      ],
    });
    const s = computeStats({ root });
    assertEqual(s.topByNotes.length, 4);
    assertEqual(s.topByNotes[0].slug, "big");
    assertEqual(s.topByNotes[0].notes, 10);
    assertEqual(s.topByNotes[3].slug, "small");
    const top3 = computeStats({ root, topLimit: 3 }).topByNotes;
    assertEqual(top3.length, 3);
    assertEqual(top3[2].slug, "tiny");
    rmrf(root);
  });

  it("tracks last activity per project (newest mtime across stores)", () => {
    const { root, vault, journal } = setupRoot({
      projects: [
        { slug: "old", notes: 1 },
        { slug: "fresh", notes: 1 },
      ],
    });
    // Force a more recent mtime on `fresh` journal entry
    const freshJournal = path.join(journal, "fresh", "journal.jsonl");
    if (fs.existsSync(freshJournal)) {
      const future = new Date("2026-06-15T10:00:00Z");
      fs.utimesSync(freshJournal, future, future);
    }
    const s = computeStats({ root });
    const fresh = s.perProject.find((p) => p.slug === "fresh");
    assert(fresh.lastActivityTs, "fresh should have lastActivityTs");
    assert(fresh.lastActivityTs >= "2026-06-15", `expected >= 2026-06-15, got ${fresh.lastActivityTs}`);
    rmrf(root);
  });

  it("returns recentActivity sorted newest first", () => {
    const { root, journal } = setupRoot({
      projects: [
        { slug: "a", journal: { entries: 1, baseTs: "2026-06-01T00:00:00Z" } },
        { slug: "b", journal: { entries: 1, baseTs: "2026-06-10T00:00:00Z" } },
      ],
    });
    const s = computeStats({ root });
    assertEqual(s.recentActivity[0].slug, "b");
    assertEqual(s.recentActivity[1].slug, "a");
    rmrf(root);
  });

  it("formatText includes totals + top projects + temp slugs", () => {
    const { root } = setupRoot({
      projects: [{ slug: "demo", notes: 7 }],
      tempSlugs: ["tmp.x-1"],
    });
    const s = computeStats({ root });
    const t = formatText(s);
    assertIncludes(t, "Dev MCP Suite");
    assertIncludes(t, "Notes:");
    assertIncludes(t, "demo");
    assertIncludes(t, "tmp.x-1");
    rmrf(root);
  });

  it("formatJson roundtrips through JSON.parse", () => {
    const stats = {
      root: "/x",
      totals: { notes: 5, journalProjects: 2, checkpoints: 1 },
      projectCount: 2,
      topByNotes: [{ slug: "p", notes: 5 }],
      recentActivity: [],
      tempSlugs: [],
      perProject: [],
    };
    const j = JSON.parse(formatJson(stats));
    assertEqual(j.root, "/x");
    assertEqual(j.totals.notes, 5);
    assertEqual(j.topByNotes[0].slug, "p");
  });

  it("handles missing stores gracefully (root dir absent)", () => {
    const root = tmpDir("stats-missing-");
    const s = computeStats({ root });
    assertEqual(s.totals.notes, 0);
    assertEqual(s.projectCount, 0);
    rmrf(root);
  });
});

await run();
