import fs from "fs/promises";
import path from "path";
import { parseFrontmatter } from "./server.js";

export function extractWikiLinks(body) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = re.exec(String(body || "")))) {
    const raw = match[0];
    const inner = match[1].trim();
    const colon = inner.indexOf(":");
    const project = colon > 0 ? inner.slice(0, colon).trim() : null;
    const ref = colon > 0 ? inner.slice(colon + 1).trim() : inner;
    const kind = /^[0-9A-Za-z_-]{6,}$/.test(ref) && !/\s/.test(ref) ? "id" : "title";
    out.push({ raw, ref, project, kind });
  }
  return out;
}

export async function loadNoteBody(projectDir, file) {
  const raw = await fs.readFile(path.join(projectDir, file), "utf8");
  return parseFrontmatter(raw).body;
}

export async function ensureGraphState({ vaultRoot, projectDir, slug, index, noteLoader }) {
  void vaultRoot;
  void slug;
  let changed = false;
  const backlinks = new Map();
  for (const note of Object.values(index.notes || {})) {
    const body = await noteLoader(projectDir, note.file);
    const links = extractWikiLinks(body).map((link) => ({
      raw: link.raw,
      ref: link.ref,
      project: link.project,
      kind: link.kind,
    }));
    const next = JSON.stringify(links);
    const prev = JSON.stringify(note.links || []);
    if (next !== prev) {
      note.links = links;
      changed = true;
    }
  }
  for (const note of Object.values(index.notes || {})) {
    for (const link of note.links || []) {
      if (link.project || link.kind !== "id") continue;
      const arr = backlinks.get(link.ref) || [];
      arr.push({ id: note.id, title: note.title });
      backlinks.set(link.ref, arr);
    }
  }
  for (const note of Object.values(index.notes || {})) {
    const next = backlinks.get(note.id) || [];
    if (JSON.stringify(next) !== JSON.stringify(note.backlinks || [])) {
      note.backlinks = next;
      changed = true;
    }
  }
  return { index, changed };
}

export async function resolveLink({ vaultRoot, currentSlug, ref, project, kind }) {
  const targetSlug = project || currentSlug;
  const indexFile = path.join(vaultRoot, targetSlug, "index.json");
  let index;
  try {
    index = JSON.parse(await fs.readFile(indexFile, "utf8"));
  } catch {
    return { status: "missing" };
  }

  const notes = Object.values(index.notes || {});
  let candidates;
  if (kind === "id") {
    candidates = notes.filter((note) => note.id === ref);
  } else {
    const target = String(ref || "").trim().toLowerCase();
    candidates = notes.filter((note) => String(note.title || "").trim().toLowerCase() === target);
  }

  if (candidates.length === 0) return { status: "missing" };
  if (candidates.length === 1) return { status: "resolved", match: candidates[0] };
  return { status: "ambiguous", candidates };
}
