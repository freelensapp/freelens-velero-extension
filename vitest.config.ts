import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "build/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["node_modules/**", "out/**", "integration/**"],
    passWithNoTests: false,
    alias: {
      "@freelensapp/extensions": fileURLToPath(new URL("./test/freelens-extensions.ts", import.meta.url)),
      undici: fileURLToPath(new URL("./build/undici-stub.ts", import.meta.url)),
    },
  },
});
