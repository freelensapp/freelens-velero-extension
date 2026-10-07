import { defineConfig } from "vitest/config";

// The measures of the unit tests, which `pnpm test:unit` runs once the other tests ended: their files one at a
// time, so that nothing of the tests runs beside what is timed. The configuration of the other tests does not
// take them, by their names. What a measure prints is printed by every reporter, also when it passes: its times
// are the evidence of the run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.measure.ts"],
    fileParallelism: false,
    passWithNoTests: false,
    silent: false,
  },
});
