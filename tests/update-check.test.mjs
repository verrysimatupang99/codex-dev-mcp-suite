import { describe, it, assert, run } from "../_testkit/harness.mjs";
import { isNewerVersion, checkForUpdates } from "../lib/update-check.js";

describe("update-check helper", () => {
  it("isNewerVersion compares semver versions correctly", () => {
    assert(isNewerVersion("1.8.2", "1.9.0"), "1.9.0 > 1.8.2");
    assert(isNewerVersion("1.8.2", "2.0.0"), "2.0.0 > 1.8.2");
    assert(isNewerVersion("1.8.2", "1.8.3"), "1.8.3 > 1.8.2");
    assert(!isNewerVersion("1.8.2", "1.8.2"), "1.8.2 is equal");
    assert(!isNewerVersion("1.8.2", "1.8.1"), "1.8.1 is older");
    assert(!isNewerVersion("2.0.0", "1.9.9"), "1.9.9 is older");
  });

  it("checkForUpdates runs without throwing or blocking", async () => {
    try {
      await checkForUpdates();
      assert(true, "checkForUpdates executed safely");
    } catch (e) {
      assert(false, `checkForUpdates threw error: ${e.message}`);
    }
  });
});

const { fail } = await run();
process.exit(fail > 0 ? 1 : 0);
