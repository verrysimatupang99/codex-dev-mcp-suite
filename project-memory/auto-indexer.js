/**
 * Autonomous Background Git, Mtime & Session Watchdog Observer for project-memory.
 * Inspects recent git commits, modified file mtimes, and chat session transcripts
 * to auto-derive project notes, extract architectural decisions, and update the
 * Obsidian knowledge vault without manual prompts.
 */

import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

async function scanSessionLogs(root, customSessionDir) {
  const decisions = [];
  const candidateDirs = customSessionDir
    ? [path.resolve(root, customSessionDir)]
    : [
        path.join(root, ".codex", "sessions"),
        path.join(root, ".codex"),
        path.join(root, ".gemini", "logs"),
        path.join(root, ".gemini"),
        path.join(root, ".agents", "logs"),
        path.join(root, "logs"),
      ];

  const filesToScan = [];
  for (const d of candidateDirs) {
    try {
      const stat = await fs.stat(d);
      if (stat.isFile() && (d.endsWith(".jsonl") || d.endsWith(".log") || d.endsWith(".json"))) {
        filesToScan.push(d);
        continue;
      }
      if (stat.isDirectory()) {
        const entries = await fs.readdir(d, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && (e.name.endsWith(".jsonl") || e.name.endsWith(".log") || e.name.endsWith(".json") || e.name.includes("history"))) {
            filesToScan.push(path.join(d, e.name));
          }
        }
      }
    } catch {}
  }

  const fileStats = [];
  for (const f of filesToScan) {
    try {
      const s = await fs.stat(f);
      fileStats.push({ file: f, mtime: s.mtimeMs });
    } catch {}
  }
  fileStats.sort((a, b) => b.mtime - a.mtime);
  const topFiles = fileStats.slice(0, 5).map((x) => x.file);

  const keywordRegex = /\b(v1|v2|v3|vs|versus|architecture|arsitektur|migration|migrasi|decision|keputusan|strategy|strategi|refactor|database|schema|tradeoff|perbedaan|kesimpulan|monolith|microservice)\b/i;

  for (const file of topFiles) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const lines = raw.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        let text = "";
        let role = "unknown";
        try {
          const parsed = JSON.parse(line);
          text = typeof parsed === "string" ? parsed : parsed.content || parsed.text || parsed.message || JSON.stringify(parsed);
          role = parsed.type || parsed.role || parsed.source || "log";
        } catch {
          text = line;
        }

        if (typeof text !== "string" || text.length < 20) continue;

        const match = text.match(keywordRegex);
        if (match) {
          const keyword = match[0].toLowerCase();
          const cleanText = text.replace(/\s+/g, " ").trim();
          const snippet = cleanText.length > 300 ? cleanText.substring(0, 300) + "..." : cleanText;
          decisions.push({
            keyword,
            role: String(role),
            snippet,
            file: path.relative(root, file) || path.basename(file),
          });
          if (decisions.length >= 10) break;
        }
      }
    } catch {}
    if (decisions.length >= 10) break;
  }

  return decisions;
}

export async function runAutoIndexer(projectDir, { dryRun = false, scanSessions = true, sessionDir = null } = {}) {
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

  // 3. Inspect recent session transcripts / chat logs if enabled
  let sessionDecisions = [];
  if (scanSessions) {
    sessionDecisions = await scanSessionLogs(root, sessionDir);
  }

  const summaryLines = [
    `# Auto-Derived Knowledge Snapshot: ${path.basename(root)}`,
    `Active Branch: \`${branch}\``,
    `Inspected At: ${new Date().toISOString()}`,
    ``,
    `## 📜 Recent Git Activity`,
    ...(gitLogs.length ? gitLogs.map((l) => `- \`${l}\``) : ["- No git history found"]),
  ];

  if (sessionDecisions.length > 0) {
    summaryLines.push(``, `## 💬 Session Conversation Digest (Watchdog)`);
    const seenKeywords = new Set();
    for (const d of sessionDecisions) {
      summaryLines.push(`- **[${d.keyword.toUpperCase()}]** (${d.file}): ${d.snippet}`);
      if (!seenKeywords.has(d.keyword)) {
        seenKeywords.add(d.keyword);
        notesCreated.push({
          title: `Session Digest: ${d.keyword.toUpperCase()} Discussion (${new Date().toISOString().substring(0, 10)})`,
          content: `# Session Digest: ${d.keyword.toUpperCase()} Discussion\n\nExtracted from conversation watchdog on branch \`${branch}\` (Source: \`${d.file}\`).\n\n## Discussion Context\n\n- **Role (${d.role})**: ${d.snippet}\n`,
          tags: ["session-digest", "watchdog", d.keyword.toLowerCase()],
        });
      }
    }
  }

  const summary = summaryLines.join("\n");

  return {
    projectDir: root,
    branch,
    recentCommits: gitLogs,
    sessionDecisions,
    summaryText: summary,
    notesCreated,
  };
}
