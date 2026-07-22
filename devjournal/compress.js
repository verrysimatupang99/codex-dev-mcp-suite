/**
 * Context compressor for devjournal.
 * Condenses verbose timeline entries into a ultra-compact (~500 token) snapshot.
 */

import fs from "fs/promises";
import path from "path";

/**
 * Compress journal entries for a project into a dense markdown summary block.
 */
export async function compressJournalEntries(journalDir, projectSlug, { limit = 50, maxTokens = 500 } = {}) {
  const projectDir = path.join(journalDir, projectSlug);
  const logFile = path.join(projectDir, "log.jsonl");

  try {
    const raw = await fs.readFile(logFile, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const entries = lines.map((l) => JSON.parse(l));

    // Sort newest first
    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const recent = entries.slice(0, limit);

    // Aggregate findings, decisions, files, and blockers
    const decisions = [];
    const blockers = [];
    const filesTouched = new Set();

    for (const e of recent) {
      if (e.entryType === "decision" || e.tags?.includes("decision")) {
        decisions.push(e.text || e.summary);
      } else if (e.entryType === "blocker" || e.tags?.includes("blocker") || e.tags?.includes("error")) {
        blockers.push(e.text || e.summary);
      }
      if (e.file || e.files) {
        const arr = Array.isArray(e.files) ? e.files : [e.file];
        arr.forEach((f) => f && filesTouched.add(f));
      }
    }

    const outputLines = [
      `# Compressed Journal Snapshot: ${projectSlug}`,
      `Generated: ${new Date().toISOString()}`,
      `Entries Processed: ${recent.length}`,
      ``,
      `## 💡 Key Decisions (${decisions.length})`,
      ...(decisions.length ? decisions.slice(0, 10).map((d) => `- ${d}`) : ["- None recorded"]),
      ``,
      `## ⚠️ Resolved/Active Blockers (${blockers.length})`,
      ...(blockers.length ? blockers.slice(0, 10).map((b) => `- ${b}`) : ["- None"]),
      ``,
      `## 📁 Files Touched (${filesTouched.size})`,
      ...(filesTouched.size ? Array.from(filesTouched).slice(0, 15).map((f) => `- \`${f}\``) : ["- None"]),
      ``,
      `## 📝 Latest Entry`,
      recent[0] ? `> ${recent[0].text || recent[0].summary} (${recent[0].timestamp})` : "No entries."
    ];

    const resultText = outputLines.join("\n");
    return {
      projectSlug,
      compressedText: resultText,
      entriesCount: recent.length,
      estimatedTokenCount: Math.ceil(resultText.length / 4),
    };
  } catch {
    return {
      projectSlug,
      compressedText: `# Compressed Journal Snapshot: ${projectSlug}\nNo log entries found.`,
      entriesCount: 0,
      estimatedTokenCount: 15,
    };
  }
}
