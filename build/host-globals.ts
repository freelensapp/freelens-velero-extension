import { createRequire } from "node:module";
import { join } from "node:path";

import type { Plugin } from "vite";

const PREFIX = "\0freelens-host:";

// What the host provides at run time, and the global it provides it under. None of these is bundled.
export const HOST_SDK = { "@freelensapp/extensions": "global.LensExtensions" };
export const HOST_STATE = { ...HOST_SDK, mobx: "global.Mobx" };
export const HOST_LIBRARIES = {
  ...HOST_STATE,
  "mobx-react": "global.MobxReact",
  react: "global.React",
  "react-dom": "global.ReactDom",
  "react/jsx-runtime": "global.ReactJsxRuntime",
};

// The SDK runs code of the browser when it loads and cannot be asked for its names: they are its three namespaces.
const NAMED: Record<string, string[]> = { "@freelensapp/extensions": ["Common", "Main", "Renderer"] };
const RESERVED = new Set(["default", "__esModule"]);

// The names a module exports, read from the installed one: a shim that names them makes the graph static,
// where one that only assigns the global leaves the bundler to guess them.
function exportedNames(moduleId: string): string[] {
  if (NAMED[moduleId]) return NAMED[moduleId];
  const loaded = createRequire(join(process.cwd(), "package.json"))(moduleId) as Record<string, unknown>;

  return Object.keys(loaded).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name) && !RESERVED.has(name));
}

// The name of a shim in the output: the name of its module without what makes it the name of a package, so
// that nothing in the bundle reads as if the package were in it.
function shimName(moduleId: string): string {
  return `${PREFIX}${moduleId.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-/, "")}`;
}

export function hostGlobals(modules: Record<string, string> = HOST_SDK): Plugin {
  const shims = new Map<string, string>();
  const named = new Map(Object.keys(modules).map((moduleId) => [shimName(moduleId), moduleId]));

  return {
    name: "freelens-host-globals",
    enforce: "pre",
    resolveId(moduleId) {
      return Object.hasOwn(modules, moduleId) ? { id: shimName(moduleId), moduleSideEffects: false } : null;
    },
    load(identifier) {
      const moduleId = named.get(identifier);

      if (moduleId === undefined) return null;
      let code = shims.get(moduleId);

      if (code === undefined) {
        const names = exportedNames(moduleId);

        code = [
          ...(NAMED[moduleId] ? [] : [`export default ${modules[moduleId]};`]),
          ...names.map((name) => `export const ${name} = ${modules[moduleId]}.${name};`),
        ].join("\n");
        shims.set(moduleId, code);
      }
      return { code, moduleSideEffects: false };
    },
  };
}
