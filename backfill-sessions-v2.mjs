#!/usr/bin/env node
/**
 * Backfill v2 — deeper session extraction + correct (original) timestamps.
 *
 * Improvements over v1:
 *  - Uses the session's ORIGINAL start timestamp (from session_meta) for both
 *    the project-memory note 'created' and the devjournal entry 'ts'.
 *  - Extracts richer content: all user prompts, plan steps (update_plan),
 *    shell commands run, files touched (apply_patch / write paths / cmd heuristics),
 *    counts (turns, commands), and the final agent summary.
 *  - Writes a richer Markdown body and richer tags.
 *  - Idempotent via its own state file (separate from v1).
 *
 * Usage:
 *   node backfill-sessions-v2.mjs --dry
 *   node backfill-sessions-v2.mjs --min-prompts 2 [--wipe]
 *
 * --wipe : delete existing vault+journal entries that came from backfill
 *          (kind/type == 'session') before re-importing, so you don't get dupes.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { McpClient } from "./_testkit/harness.mjs";

const HOME = os.homedir();
const SESS_ROOT = path.join(HOME, ".codex", "sessions");
const MEM_ROOT = path.join(HOME, ".codex", "memories");
const VAULT = path.join(MEM_ROOT, "vault");
const JOURNAL = path.join(MEM_ROOT, "journal");
const STATE_FILE = path.join(MEM_ROOT, ".backfill-v2-state.json");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const WIPE = args.includes("--wipe");
const MIN_PROMPTS = (() => { const i = args.indexOf("--min-prompts"); return i !== -1 ? Number(args[i + 1] || 1) : 1; })();

function* walk(dir) {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
  }
}
function textFromContent(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => x?.text || "").join(" ").trim();
  return "";
}
function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; }

function firstCmdToken(cmd) {
  // crude: pull the program + maybe subcommand
  const c = String(cmd || "").trim();
  const m = c.match(/^[A-Za-z0-9_./-]+(\s+[A-Za-z0-9_-]+)?/);
  return m ? m[0] : "";
}

function looksLikePath(raw) {
  let p = String(raw || "").trim();
  if (!p) return null;
  // strip surrounding quotes
  p = p.replace(/^['"]|['"]$/g, "");
  // reject obvious non-paths
  if (p.length < 3 || p.length > 200) return null;
  if (/[\s'"`(){}<>|;]/.test(p)) return null;        // whitespace / shell / code punctuation
  if (/^-/.test(p)) return null;                       // flags like -100, -rf
  if (/^\d+$/.test(p)) return null;                    // pure numbers
  if (/^(https?|ftp):/.test(p)) return null;           // urls
  if (p === "/dev/null" || p === "/dev/stdin" || p === "/dev/stdout") return null;
  if (/^[a-z]{1,4}\.(json|status|tipe|score|data|body|text|value|length)$/.test(p)) return null; // method calls: r.json res.body
  if (/\.[A-Za-z]+-[A-Za-z]/.test(p)) return null;     // code expr like b.score-a.score
  if (!p.includes("/") && (p.match(/\./g) || []).length >= 2) return null; // chained member access: m.rows.length, e.currentTarget.form
  // JS-ish member access: Foo.bar, a.replace, JSON.stringify (dot but no slash, lowerCamel/UpperCamel)
  const hasSlash = p.includes("/");
  const hasExt = /\.[A-Za-z0-9]{1,6}$/.test(p);
  if (!hasSlash && !hasExt) return null;               // must look like a path or have a file extension
  // if it has a dot but no slash, ensure it's a real ext, not method call (e.g. s.replace)
  if (!hasSlash && hasExt) {
    const parts = p.split(".");
    const base = parts[0];
    const ext = parts[parts.length - 1];
    // method/property access like s.replace, k.tipe, r.status, Math.round, JSON.stringify
    if (parts.length === 2 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(base) && /^[a-z]/.test(ext)) {
      // looks like identifier.method — only accept if it has a known file extension
      const knownExt = ["js","mjs","cjs","ts","tsx","jsx","py","go","rs","java","rb","php","c","cpp","h","sh","json","md","txt","yml","yaml","toml","css","html","sql","env","lock","cfg","ini","xml","csv"];
      if (!knownExt.includes(ext.toLowerCase())) return null;
    }
  }
  // collapse redirect/glob artifacts
  if (/[*?]/.test(p)) return null;
  return p;
}

function parseSession(file) {
  let cwd = null, startTs = null, id = null, model = null;
  const userMsgs = [];
  let lastAssistant = "";
  let plan = null;
  const cmds = [];
  const tools = {};
  const files = new Set();
  let turns = 0, reasoningCount = 0;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const p = d.payload || {};
    if (d.type === "session_meta") { cwd = p.cwd || cwd; startTs = p.timestamp || startTs; id = p.id || id; model = p.model_provider || model; }
    if (d.type === "turn_context") { if (!cwd) cwd = p.cwd || cwd; }
    if (d.type === "event_msg" && p.type === "task_started") turns++;
    if (d.type === "event_msg" && p.type === "agent_reasoning") reasoningCount++;
    if (d.type === "event_msg" && p.type === "user_message") {
      const m = (p.message || "").trim();
      if (m && !m.startsWith("<environment_context") && !m.startsWith("[Context:") &&
          !m.startsWith("<INSTRUCTIONS") && !m.startsWith("# AGENTS.md")) userMsgs.push(m);
    }
    if (d.type === "response_item" && p.type === "message" && p.role === "assistant") {
      const t = textFromContent(p.content);
      if (t) lastAssistant = t;
    }
    if (d.type === "response_item" && p.type === "function_call") {
      const name = p.name || "?";
      tools[name] = (tools[name] || 0) + 1;
      let a = {}; try { a = JSON.parse(p.arguments || "{}"); } catch { /* ignore */ }
      if (name === "exec_command" && a.cmd) cmds.push(a.cmd);
      if (name === "update_plan" && Array.isArray(a.plan)) plan = a.plan.map((s) => s.step);
      // file heuristics
      if (a.path) { const v = looksLikePath(a.path); if (v) files.add(v); }
      if (name === "apply_patch" && typeof a.input === "string") {
        for (const mm of a.input.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)) {
          const v = looksLikePath(mm[1]); if (v) files.add(v);
        }
      }
      if (name === "exec_command" && a.cmd) {
        const fm = String(a.cmd).match(/(?:cat|vim|nano|touch|rm|cp|mv|head|tail|less|sed -n|node|python3?)\s+([^\s|;&>]+)/g) || [];
        for (const x of fm) { const parts = x.split(/\s+/); const cand = looksLikePath(parts[parts.length - 1]); if (cand) files.add(cand); }
        const apply = String(a.cmd).match(/(?:>|>>)\s*([A-Za-z0-9_./-]+)/g) || [];
        for (const x of apply) { const v = looksLikePath(x.replace(/^>+\s*/, "")); if (v) files.add(v); }
      }
    }
  }
  if (!id) id = path.basename(file).replace(/\.jsonl$/, "");
  return { file, id, cwd, startTs, model, userMsgs, lastAssistant, plan, cmds, tools, files: [...files], turns, reasoningCount };
}

function buildBody(s) {
  const lines = [];
  lines.push(`Session ${s.id}`);
  lines.push(`Started: ${s.startTs}`);
  lines.push(`Project: ${s.cwd}`);
  lines.push(`Turns: ${s.turns} | prompts: ${s.userMsgs.length} | commands: ${s.cmds.length} | reasoning steps: ${s.reasoningCount}`);
  const toolList = Object.entries(s.tools).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(", ");
  if (toolList) lines.push(`Tools: ${toolList}`);

  if (s.userMsgs.length) {
    lines.push(`\n## Prompts (${s.userMsgs.length})`);
    s.userMsgs.slice(0, 20).forEach((m, i) => lines.push(`${i + 1}. ${clip(m, 220)}`));
    if (s.userMsgs.length > 20) lines.push(`… +${s.userMsgs.length - 20} more`);
  }
  if (s.plan && s.plan.length) {
    lines.push(`\n## Plan`);
    s.plan.slice(0, 20).forEach((p) => lines.push(`- ${clip(p, 120)}`));
  }
  if (s.cmds.length) {
    lines.push(`\n## Commands (${s.cmds.length}, sample)`);
    const sample = s.cmds.slice(0, 25);
    sample.forEach((c) => lines.push(`$ ${clip(c, 160)}`));
    if (s.cmds.length > 25) lines.push(`… +${s.cmds.length - 25} more`);
  }
  if (s.files.length) {
    lines.push(`\n## Files touched (${s.files.length})`);
    s.files.slice(0, 40).forEach((f) => lines.push(`- ${f}`));
    if (s.files.length > 40) lines.push(`… +${s.files.length - 40} more`);
  }
  if (s.lastAssistant) {
    lines.push(`\n## Final assistant note`);
    lines.push(clip(s.lastAssistant, 800));
  }
  return lines.join("\n");
}

function topicTags(s) {
  // derive a few tags from frequent command tokens
  const freq = {};
  for (const c of s.cmds) { const t = firstCmdToken(c).split(/\s+/)[0]; if (t) freq[t] = (freq[t] || 0) + 1; }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { done: {} }; } }
function saveState(st) { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); }

// ---- wipe old backfill entries (kind/type session) ----
function wipeSessionEntries() {
  let removedNotes = 0, removedJ = 0;
  // vault
  for (const idxFile of (function* () { for (const d of safeList(VAULT)) yield path.join(VAULT, d, "index.json"); })()) {
    if (!fs.existsSync(idxFile)) continue;
    let idx; try { idx = JSON.parse(fs.readFileSync(idxFile, "utf8")); } catch { continue; }
    const pdir = path.dirname(idxFile);
    for (const [id, n] of Object.entries(idx.notes || {})) {
      if (n.kind === "session") {
        try { fs.unlinkSync(path.join(pdir, n.file)); } catch { /* ignore */ }
        delete idx.notes[id]; removedNotes++;
      }
    }
    fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2));
  }
  // journal: rewrite jsonl/md without session-type entries
  for (const d of safeList(JOURNAL)) {
    const jdir = path.join(JOURNAL, d);
    const jsonl = path.join(jdir, "journal.jsonl");
    if (!fs.existsSync(jsonl)) continue;
    const kept = [];
    for (const line of fs.readFileSync(jsonl, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "session") { removedJ++; continue; }
      kept.push(line);
    }
    fs.writeFileSync(jsonl, kept.length ? kept.join("\n") + "\n" : "");
    // rebuild md mirror minimally
    const md = path.join(jdir, "journal.md");
    const mdLines = kept.map((l) => { const e = JSON.parse(l); return `\n## ${e.ts} — ${e.type}${e.title ? `: ${e.title}` : ""}\n${e.body || ""}\n`; });
    fs.writeFileSync(md, mdLines.join(""));
  }
  return { removedNotes, removedJ };
}
function safeList(dir) { try { return fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()); } catch { return []; } }

// ---- collect ----
const state = loadState();
const sessions = [];
for (const f of walk(SESS_ROOT)) {
  let s; try { s = parseSession(f); } catch { continue; }
  if (!s.cwd) continue;
  if (s.userMsgs.length < MIN_PROMPTS) continue;
  sessions.push(s);
}
sessions.sort((a, b) => String(a.startTs).localeCompare(String(b.startTs)));

if (WIPE && !DRY) {
  const { removedNotes, removedJ } = wipeSessionEntries();
  console.log(`Wiped ${removedNotes} session notes + ${removedJ} session journal entries.`);
  state.done = {}; // re-import everything fresh
}

const pending = sessions.filter((s) => !state.done[s.id]);

console.log(`Sessions >= ${MIN_PROMPTS} prompts: ${sessions.length}. Done: ${sessions.length - pending.length}. Pending: ${pending.length}.`);

if (DRY) {
  const ex = pending.find((s) => s.cmds.length > 5) || pending[0];
  if (ex) {
    console.log(`\n--- Example deep extraction (${ex.id}) ---`);
    console.log(`date: ${ex.startTs}`);
    console.log(`cwd: ${ex.cwd}`);
    console.log(`turns=${ex.turns} prompts=${ex.userMsgs.length} cmds=${ex.cmds.length} files=${ex.files.length}`);
    console.log(`tags: session,backfill,${ex.startTs?.slice(0,10)},${topicTags(ex).join(",")}`);
    console.log("\n" + buildBody(ex).slice(0, 1200));
  }
  process.exit(0);
}

const env = { MEMORY_VAULT_DIR: VAULT, JOURNAL_DIR: JOURNAL, NINEROUTER_KEY: "", EMBED_KEY: "", RERANK_ENABLED: "0" };
const mem = new McpClient(path.join(import.meta.dirname, "project-memory", "server.js"), env);
const jrnl = new McpClient(path.join(import.meta.dirname, "devjournal", "server.js"), env);
await mem.start(); await jrnl.start();

let ok = 0, errs = 0;
for (const s of pending) {
  const date = (s.startTs || "").slice(0, 10);
  const title = clip(s.userMsgs[0] || "(no prompt)", 90);
  const body = buildBody(s);
  const tags = ["session", "backfill", date, ...topicTags(s)];
  try {
    await mem.callTool("memory_save", { dir: s.cwd, title: `[session ${date}] ${title}`, content: body, tags, kind: "session", created: s.startTs }, 60000);
    await jrnl.callTool("journal_log", { dir: s.cwd, title: `Session ${date}: ${title}`, type: "session", ts: s.startTs,
      body: `turns=${s.turns} cmds=${s.cmds.length} files=${s.files.length} | ${clip(s.userMsgs.join(" | "), 300)}` }, 60000);
    state.done[s.id] = { cwd: s.cwd, ts: s.startTs };
    ok++;
    if (ok % 20 === 0) { saveState(state); console.log(`  ...${ok} written`); }
  } catch (e) { errs++; console.log(`  ! ${s.id}: ${e.message}`); }
}
saveState(state);
await mem.stop(); await jrnl.stop();
console.log(`\nDone. Wrote ${ok}, errors ${errs}. State: ${STATE_FILE}`);
