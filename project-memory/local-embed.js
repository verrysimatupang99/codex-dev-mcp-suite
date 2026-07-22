/**
 * Local offline vector embedding engine (384-dimensional term-frequency hashing vector).
 * Zero external dependencies, zero network calls, sub-millisecond execution.
 *
 * Provides a reliable fallback for semantic search when no remote API keys
 * (OpenAI/Cloudflare/Gemini/Ollama) are available.
 */

const VECTOR_DIM = 384;

/** Simple hash function for N-gram string to integer bucket [0, VECTOR_DIM-1] */
function hashNgram(ngram) {
  let hash = 5381;
  for (let i = 0; i < ngram.length; i++) {
    hash = ((hash << 5) + hash) + ngram.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) % VECTOR_DIM;
}

/**
 * Generate a 384-dimensional L2-normalized vector for a text string.
 * @param {string} text 
 * @returns {number[]} Array of 384 float numbers
 */
export function generateLocalVector(text) {
  if (!text || typeof text !== "string") {
    return new Array(VECTOR_DIM).fill(0);
  }

  const normalized = text.toLowerCase().trim();
  if (!normalized) {
    return new Array(VECTOR_DIM).fill(0);
  }

  const vec = new Array(VECTOR_DIM).fill(0);

  // Extract word tokens and character 3-grams
  const words = normalized.split(/\s+/).filter(Boolean);
  
  // 1. Process words (higher weight)
  for (const word of words) {
    const cleanWord = word.replace(/[^a-z0-9]/g, "");
    if (!cleanWord) continue;
    
    const idx = hashNgram(cleanWord);
    vec[idx] += 2.0;

    // 2. Process character 3-grams for fuzzy matching
    if (cleanWord.length >= 3) {
      for (let i = 0; i <= cleanWord.length - 3; i++) {
        const sub = cleanWord.substring(i, i + 3);
        const subIdx = hashNgram(sub);
        vec[subIdx] += 1.0;
      }
    }
  }

  // 3. Sublinear term-frequency scaling (1 + log(tf))
  for (let i = 0; i < VECTOR_DIM; i++) {
    if (vec[i] > 0) {
      vec[i] = 1 + Math.log(vec[i]);
    }
  }

  // 4. L2 Normalization (unit length vector)
  let normSq = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    normSq += vec[i] * vec[i];
  }

  if (normSq === 0) {
    return vec;
  }

  const norm = Math.sqrt(normSq);
  for (let i = 0; i < VECTOR_DIM; i++) {
    vec[i] = vec[i] / norm;
  }

  return vec;
}

/**
 * Generate vectors for an array of strings.
 * @param {string[]} inputs 
 * @returns {number[][]}
 */
export function generateLocalVectors(inputs) {
  const arr = Array.isArray(inputs) ? inputs : [inputs];
  return arr.map((t) => generateLocalVector(t));
}
