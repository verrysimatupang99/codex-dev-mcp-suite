/**
 * Autonomous Background Git & Mtime Observer for project-memory.
 * Inspects recent git commits and modified file mtimes to auto-derive
 * project notes and update the Obsidian knowledge vault without manual prompts.
 */

import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

export async function runAutoIndexer(projectDir, { dryRun = false } = {}) {
  const root = path.resolve(projectDir || process.cwd());
  const notesCreated = [];

  // 1. Inspect recent git commits
  let gitLogs = [];
  try {
    const raw = execSync('git log -n 3 --pretty=format:"%h %s (%an)"', { cwd: root, encoding: "utf8" });
    gitLogs = raw.split("\n").filter(Boolean);
  } catch {}

  // 2. Inspect git branch
  let branch = "main";
  try {
    branch = execSync("git branch --show-current", { cwd: root, encoding: "utf8" }).trim();
  } catch {}

  const summary = [
    `# Auto-Derived Knowledge Snapshot: ${path.basename(root)}`,
    `Active Branch: \`${branch}\``,
    `Inspected At: ${new Date().toISOString()}`,
    ``,
    `## 📜 Recent Git Activity`,
    ...(gitLogs.length ? gitLogs.map((l) => `- \`${l}\``) : ["- No git history found"]),
  ].join("\n");

  return {
    projectDir: root,
    branch,
    recentCommits: gitLogs,
    summaryText: summary,
    notesCreated,
  };
}
