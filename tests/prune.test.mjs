/**
 * Tests for prune CLI library.
 * Run directly: node tests/prune.test.mjs
 */
import {
  describe, it, assert, assertEqual, run, tmpDir, rmrf,
} from "../_testkit/harness.mjs";
import fs from "fs";
import path from "path";
import { findTempSlugs, estimateBytes, planPrune, applyPrune } from "../lib/prune.js";

function setupRoot(opts = {}) {
  const root = tmpDir("prune-test-");
  const vault = path.join(root, "vault");
  const journal = path.join(root, "journal");
  const checkpoints = path.join(root, "checkpoints");
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(journal, { recursive: true });
  fs.mkdirSync(checkpoints, { recursive: true });
  const { tempSlugs = [], realSlugs = [] } = opts;
  for (const slug of [...tempSlugs, ...realSlugs]) {
    fs.mkdirSync(path.join(vault, slug, "notes"), { recursive: true });
    fs.writeFileSync(path.join(vault, slug, "notes", "n.md"), "x");
    fs.mkdirSync(path.join(journal, slug), { recursive: true });
    fs.writeFileSync(path.join(journal, slug, "journal.jsonl"), "{\"ts\":\"x\"}\n");
  }
  return root;
}

describe("prune lib", () => {
  it("finds temp slugs (prefix tmp.) across all stores", () => {
    const root = setupRoot({ tempSlugs: ["tmp.aaa-1", "tmp.bbb-2"], realSlugs: ["real-1"] });
    const found = findTempSlugs({ root });
    assertEqual(found.length, 2);
    assert(found.includes("tmp.aaa-1"));
    assert(found.includes("tmp.bbb-2"));
    assert(!found.includes("real-1"));
    rmrf(root);
  });

  it("returns empty when no temp slugs present", () => {
    const root = setupRoot({ realSlugs: ["a", "b"] });
    assertEqual(findTempSlugs({ root }).length, 0);
    rmrf(root);
  });

  it("estimates bytes for temp slug trees", () => {
    const root = setupRoot({ tempSlugs: ["tmp.x-1"] });
    const bytes = estimateBytes({ root, slugs: ["tmp.x-1"] });
    assert(bytes > 0, "expected positive byte count");
    rmrf(root);
  });

  it("planPrune returns entries with slug + bytes per store", () => {
    const root = setupRoot({ tempSlugs: ["tmp.aaa"] });
    const plan = planPrune({ root });
    assertEqual(plan.length, 1);
    assertEqual(plan[0].slug, "tmp.aaa");
    assert(plan[0].bytes > 0);
    assert(Array.isArray(plan[0].stores));
    assert(plan[0].stores.includes("vault"));
    rmrf(root);
  });

  it("applyPrune removes slug dirs from all stores when dryRun=false", () => {
    const root = setupRoot({ tempSlugs: ["tmp.del-1"] });
    const result = applyPrune({ root, slugs: ["tmp.del-1"], dryRun: false });
    assertEqual(result.removed.length, 1);
    assertEqual(result.errors.length, 0);
    // verify gone
    assert(!fs.existsSync(path.join(root, "vault", "tmp.del-1")));
    assert(!fs.existsSync(path.join(root, "journal", "tmp.del-1")));
    rmrf(root);
  });

  it("applyPrune is no-op when dryRun=true", () => {
    const root = setupRoot({ tempSlugs: ["tmp.keep-1"] });
    const result = applyPrune({ root, slugs: ["tmp.keep-1"], dryRun: true });
    assertEqual(result.removed.length, 0);
    assert(fs.existsSync(path.join(root, "vault", "tmp.keep-1")), "should not delete on dry-run");
    rmrf(root);
  });

  it("applyPrune returns {removed,skipped,errors} shape", () => {
    const root = setupRoot({ tempSlugs: ["tmp.shape-1"] });
    const r = applyPrune({ root, slugs: ["tmp.shape-1"], dryRun: true });
    assert(Array.isArray(r.removed));
    assert(Array.isArray(r.skipped));
    assert(Array.isArray(r.errors));
    assertEqual(r.removed.length, 0);
    assert(r.skipped.length >= 1, "dry-run should populate skipped");
    rmrf(root);
  });

  it("applyPrune dryRun=false with empty slugs is no-op", () => {
    const root = setupRoot({ realSlugs: ["keep-me"] });
    const r = applyPrune({ root, slugs: [], dryRun: false });
    assertEqual(r.removed.length, 0);
    assert(fs.existsSync(path.join(root, "vault", "keep-me")));
    rmrf(root);
  });

  it("refuses to remove slugs that do not start with tmp.", () => {
    const root = setupRoot({ realSlugs: ["real-x"] });
    let threw = false;
    try {
      applyPrune({ root, slugs: ["real-x"], dryRun: false });
    } catch (e) {
      threw = true;
      assertIncludes(e.message, "tmp.");
    }
    assert(threw, "expected throw on non-temp slug");
    // verify not deleted
    assert(fs.existsSync(path.join(root, "vault", "real-x")));
    rmrf(root);
  });
});

function assertIncludes(a, b, m) {
  if (!String(a).includes(String(b))) throw new Error(`expected "${a}" to include "${b}"${m ? " - " + m : ""}`);
}

await run();
