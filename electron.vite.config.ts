import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import { hostGlobals } from "./build/host-globals";

const runtimeExternals = [
  "electron",
  /^electron\//,
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];
const preserveModules = (process.env.VITE_PRESERVE_MODULES ?? "true") === "true";

export default defineConfig({
  main: {
    plugins: [hostGlobals()],
    resolve: {
      alias: {
        undici: resolve(__dirname, "build/undici-stub.ts"),
      },
    },
    define: {
      "process.env.WS_NO_BUFFER_UTIL": '"1"',
      "process.env.WS_NO_UTF_8_VALIDATE": '"1"',
    },
    build: {
      lib: {
        entry: resolve(__dirname, "src/main/index.ts"),
        formats: ["cjs"],
      },
      rolldownOptions: {
        external: runtimeExternals,
        output: {
          exports: "named",
          preserveModules,
          preserveModulesRoot: "src/main",
        },
      },
      sourcemap: true,
    },
  },
  preload: {
    plugins: [hostGlobals()],
    build: {
      lib: {
        entry: resolve(__dirname, "src/renderer/index.ts"),
        formats: ["cjs"],
      },
      outDir: "out/renderer",
      rolldownOptions: {
        external: runtimeExternals,
        output: {
          exports: "named",
          preserveModules,
          preserveModulesRoot: "src/renderer",
        },
      },
      sourcemap: true,
    },
  },
});
