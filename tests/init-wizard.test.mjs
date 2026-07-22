import { describe, it, assert, run } from "../_testkit/harness.mjs";
import { detectClients, runInitWizard } from "../lib/init-wizard.js";

describe("init-wizard helper", () => {
  it("detectClients runs without throwing", async () => {
    const clients = await detectClients();
    assert(Array.isArray(clients), "returns array of clients");
  });

  it("runInitWizard --dry-run previews client setup", async () => {
    const res = await runInitWizard({ dryRun: true });
    assert(typeof res.detectedCount === "number", "returns detectedCount");
    assert(Array.isArray(res.results), "returns results array");
  });
});

const { fail } = await run();
process.exit(fail > 0 ? 1 : 0);
