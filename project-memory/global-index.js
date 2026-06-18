import fs from "fs/promises";
import path from "path";

export async function listProjects(vaultRoot) {
  let slugs = [];
  try {
    slugs = await fs.readdir(vaultRoot);
  } catch {
    slugs = [];
  }
  return slugs.map((slug) => ({
    slug,
    projectDir: path.join(vaultRoot, slug),
    indexFile: path.join(vaultRoot, slug, "index.json"),
  }));
}

export async function loadGlobalNotes(vaultRoot) {
  const projects = await listProjects(vaultRoot);
  const rows = [];
  for (const project of projects) {
    try {
      const raw = await fs.readFile(project.indexFile, "utf8");
      const index = JSON.parse(raw);
      for (const note of Object.values(index.notes || {})) rows.push({ slug: project.slug, note });
    } catch {
      // ignore invalid or incomplete project index
    }
  }
  return rows;
}

export async function findGlobalCandidates({ vaultRoot, currentSlug, query }) {
  const q = String(query || "").toLowerCase();
  const rows = await loadGlobalNotes(vaultRoot);
  return rows
    .filter(({ note }) =>
      String(note.title || "").toLowerCase().includes(q) ||
      (note.keywords || []).some((keyword) => String(keyword).toLowerCase().includes(q))
    )
    .sort((a, b) => {
      const ap = a.slug === currentSlug ? 0 : 1;
      const bp = b.slug === currentSlug ? 0 : 1;
      return ap - bp || (a.note.created < b.note.created ? 1 : -1);
    });
}
