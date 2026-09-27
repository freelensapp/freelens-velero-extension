import type { Plugin } from "vite";

const virtualModuleId = "\0freelens-host-extensions";

export function hostGlobals(): Plugin {
  return {
    name: "freelens-host-globals",
    enforce: "pre",
    resolveId(moduleId) {
      if (moduleId === "@freelensapp/extensions") {
        return { id: virtualModuleId, moduleSideEffects: false };
      }

      return null;
    },
    load(moduleId) {
      if (moduleId !== virtualModuleId) {
        return null;
      }

      return {
        code: [
          "export const Common = global.LensExtensions.Common;",
          "export const Main = global.LensExtensions.Main;",
          "export const Renderer = global.LensExtensions.Renderer;",
        ].join("\n"),
        moduleSideEffects: false,
      };
    },
  };
}
