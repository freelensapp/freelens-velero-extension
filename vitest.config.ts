import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { standardDecorators } from "./build/vite-plugin-standard-decorators.mjs";

export default defineConfig({
  plugins: [
    // Lowers the standard decorators (`@observable accessor`) before Oxc, as in
    // the build; Oxc passes them through and Node cannot run them.
    standardDecorators(),
    // Transforms JSX/TSX the same way the build does, so component tests
    // render correctly.
    react(),
  ],
  test: {
    // Default to a Node environment. Tests that render React components opt into
    // jsdom per-file with a `// @vitest-environment jsdom` comment at the top.
    environment: "node",
    // Tests import describe, it, expect, vi and the hooks from "vitest"; no
    // tsconfig declares them as globals. `globals` is on at runtime because
    // React Testing Library registers its automatic `afterEach(cleanup)` only
    // when `afterEach` exists as a global.
    globals: true,
    exclude: ["integration/**", "node_modules/**", "dist/**"],
    // The tests of the sources, and the build and environment tests of `test/`: the files that
    // `src/tsconfig.json` type-checks. The measures are left to `test/measure.config.ts`.
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
    passWithNoTests: false,
    alias: {
      // The host provides `@freelensapp/extensions` on
      // `globalThis.FreelensExtensionApi`, and the package is a shim that reads
      // that global when it is imported, so the real package throws in a test.
      // Tests import a stub instead - see `test/freelens-extensions.ts`.
      // The other host modules (react, mobx, ...) resolve to the
      // devDependencies, which are pinned to the host's versions.
      "@freelensapp/extensions": fileURLToPath(new URL("./test/freelens-extensions.ts", import.meta.url)),
      // As in the main build: the Kubernetes client imports undici for API clients the extension
      // never calls, and the real module installs a dispatcher for the whole process.
      undici: fileURLToPath(new URL("./build/undici-stub.ts", import.meta.url)),
    },
  },
});
