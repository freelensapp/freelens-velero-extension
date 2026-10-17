import { defineConfig } from "vitest/config";

// The integration test and the suites of the views start a packaged Freelens and
// drive it, so they are not part of vitest.config.ts and run only through
// `pnpm test:integration`, which `pnpm e2e:views` calls with the name of a suite.
// `FREELENS_APP` names the application they start.
export default defineConfig({
  test: {
    name: "integration",
    environment: "node",
    include: ["integration/__tests__/**/*.tests.ts", "e2e/__tests__/**/*.tests.ts"],
    // One application at a time: the suites read what the API server counts of the
    // whole cluster, and the host gives its loader ten seconds to see an
    // extension it unpacked, which a second application would take from it.
    fileParallelism: false,
    // Every case and hook of a suite gives itself its time; these are for the
    // ones that do not.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // A suite that fails is a failure: nothing runs it again.
    retry: 0,
  },
});
