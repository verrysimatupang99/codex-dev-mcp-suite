function jaccard(left, right) {
  const leftSet = new Set(left.filter(Boolean));
  const rightSet = new Set(right.filter(Boolean));
  const intersection = [...leftSet].filter((item) => rightSet.has(item)).length;
  const union = new Set([...leftSet, ...rightSet]).size || 1;
  return intersection / union;
}

function tokenizeBody(text) {
  return String(text || "").toLowerCase().split(/\W+/).filter(Boolean);
}

export function scoreDuplicatePair({ a, b, aBody, bBody }) {
  const reasons = [];
  let score = 0;

  if (String(a.title || "").trim().toLowerCase() === String(b.title || "").trim().toLowerCase()) {
    score += 0.5;
    reasons.push("exact normalized title match");
  }

  const bodyScore = jaccard(tokenizeBody(aBody), tokenizeBody(bBody));
  score += bodyScore * 0.4;
  if (bodyScore >= 0.75) reasons.push("strong content overlap");

  const linkScore = jaccard((a.links || []).map((link) => `${link.project || ""}:${link.ref || ""}`), (b.links || []).map((link) => `${link.project || ""}:${link.ref || ""}`));
  score += linkScore * 0.1;
  if (linkScore >= 0.75 && (a.links || []).length && (b.links || []).length) reasons.push("similar link neighborhood");

  return { score: Math.min(1, score), reasons };
}

export function findDuplicateCandidates({ rows, threshold }) {
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const result = scoreDuplicatePair({
        a: rows[i].note,
        b: rows[j].note,
        aBody: rows[i].body,
        bBody: rows[j].body,
      });
      if (result.score >= threshold) {
        out.push({ left: rows[i], right: rows[j], score: result.score, reasons: result.reasons });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
