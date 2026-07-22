import { describe, it, assert, run } from "../_testkit/harness.mjs";
import { generateLocalVector, generateLocalVectors } from "../project-memory/local-embed.js";
import { embed, embedOne, cosine, recallMode, embeddingConfig } from "../project-memory/embedding.js";

describe("local offline embeddings", () => {
  it("generateLocalVector produces 384-length L2 normalized vector", () => {
    const vec = generateLocalVector("hello world memory test");
    assert(Array.isArray(vec), "must be array");
    assert(vec.length === 384, "must be 384 dim");

    // Check L2 norm is ~1.0
    let normSq = 0;
    for (const v of vec) normSq += v * v;
    const norm = Math.sqrt(normSq);
    assert(Math.abs(norm - 1.0) < 0.001, `vector norm should be 1.0, got ${norm}`);
  });

  it("cosine similarity gives high score for similar texts and low score for unrelated", () => {
    const v1 = generateLocalVector("postgresql database connection error");
    const v2 = generateLocalVector("postgres db disconnect issue");
    const v3 = generateLocalVector("recipe for chocolate chip cookies");

    const simSimilar = cosine(v1, v2);
    const simUnrelated = cosine(v1, v3);

    assert(simSimilar > simUnrelated, `similar (${simSimilar}) must be higher than unrelated (${simUnrelated})`);
  });

  it("embed fallback to local vectors when MCP_LOCAL_EMBED=true and no API key is provided", async () => {
    const origKey = process.env.MCP_EMBED_API_KEY;
    const origLocal = process.env.MCP_LOCAL_EMBED;
    delete process.env.MCP_EMBED_API_KEY;
    delete process.env.MCP_LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.EMBED_KEY;
    delete process.env.NINEROUTER_KEY;
    process.env.MCP_LOCAL_EMBED = "true";

    try {
      const mode = recallMode();
      assert(mode === "semantic (local)", `mode should be semantic (local), got ${mode}`);

      const cfg = embeddingConfig();
      assert(cfg.endpoint === "local-offline", `endpoint should be local-offline, got ${cfg.endpoint}`);

      const vecs = await embed(["test text"]);
      assert(vecs.length === 1, "vecs length 1");
      assert(vecs[0].length === 384, "vec length 384");

      const one = await embedOne("single text");
      assert(one !== null, "embedOne returns vector");
      assert(one.length === 384, "embedOne length 384");
    } finally {
      if (origKey) process.env.MCP_EMBED_API_KEY = origKey;
      if (origLocal) process.env.MCP_LOCAL_EMBED = origLocal; else delete process.env.MCP_LOCAL_EMBED;
    }
  });
});

const { fail } = await run();
process.exit(fail > 0 ? 1 : 0);
