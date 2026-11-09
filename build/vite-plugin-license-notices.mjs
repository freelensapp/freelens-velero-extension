/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Writes beside a bundle the license notices of the libraries it carries.
//
// A library a bundle carries is copied into the package, and its license, the
// MIT license of react-window among them, asks that its copyright and
// permission notice be included in every copy. A bundle that carries a library
// gets a file beside it, `<bundle>.LICENSE.txt`, the name a bundler gives such
// a file, with the name, the version and the license file of every package of
// node_modules the chunk holds a module of, as the package ships them: the
// notice is the one of the version the lockfile installed. The shim of the SDK
// of the host is not a library: it reads the API Freelens provides at run
// time, and DEPENDENCY-AUDIT.md counts it with the code of the extension. A
// library that ships no license file fails the build.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The package of the SDK of the host, whose shim the bundles carry. */
const hostSdk = "@freelensapp/extensions";

/** A license file as packages name it: LICENSE, LICENCE or COPYING, with or without an extension, in any case. */
const licenseFile = /^(?:licen[cs]e|copying)(?:[.-].*)?$/i;

/**
 * The folder of the package of node_modules a module is part of, or nothing for a module of the extension.
 *
 * @param {string} moduleId
 */
function packageFolder(moduleId) {
  // The last node_modules of the path holds the package: the folders before it are the store of pnpm.
  return /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(moduleId.replaceAll("\\", "/"))?.[1];
}

/** @returns {import("vite").Plugin} */
export function licenseNotices() {
  return {
    name: "freelens:license-notices",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        /** @type {Map<string, { name: string; version: string; notice: string }>} */
        const libraries = new Map();

        for (const folder of new Set(chunk.moduleIds.map(packageFolder))) {
          if (!folder) continue;
          /** @type {{ name: string; version: string }} */
          const { name, version } = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));

          if (name === hostSdk) continue;
          const [file] = readdirSync(folder)
            .filter((entry) => licenseFile.test(entry))
            .sort();

          if (!file) this.error(`${name} ${version}, which ${chunk.fileName} carries, ships no license file`);
          libraries.set(name, { name, version, notice: readFileSync(join(folder, file), "utf8").trim() });
        }
        if (!libraries.size) continue;
        const notices = [...libraries.values()]
          .sort((one, other) => one.name.localeCompare(other.name))
          .map(({ name, version, notice }) => `${name} ${version}\n\n${notice}\n`);

        this.emitFile({
          type: "asset",
          fileName: `${chunk.fileName}.LICENSE.txt`,
          source: [
            `${chunk.fileName} carries these libraries, each with the notice of its license.\n`,
            ...notices,
          ].join("\n"),
        });
      }
    },
  };
}
