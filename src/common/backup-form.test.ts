import { describe, expect, it } from "vitest";
import { backupFromForm, formBodyText, readFormBody } from "./backup-form";

describe("the backup of the form", () => {
  it("is a Backup with its name and its namespace, no label and no annotation, and the fields that were set", () => {
    const body = backupFromForm("velero", "shop-by-hand", {
      includedNamespaces: ["shop"],
      storageLocation: "default",
      ttl: "48h",
    });

    expect(body).toEqual({
      apiVersion: "velero.io/v1",
      kind: "Backup",
      metadata: { name: "shop-by-hand", namespace: "velero" },
      spec: { includedNamespaces: ["shop"], storageLocation: "default", ttl: "48h0m0s" },
    });
  });

  it("is written once, with two spaces and the keys of the spec in the order of their characters", () => {
    const body = backupFromForm("velero", "shop-by-hand", {
      ttl: "48h",
      storageLocation: "default",
      includedNamespaces: ["shop"],
    });

    expect(body && formBodyText(body)).toBe(
      [
        "{",
        '  "apiVersion": "velero.io/v1",',
        '  "kind": "Backup",',
        '  "metadata": {',
        '    "name": "shop-by-hand",',
        '    "namespace": "velero"',
        "  },",
        '  "spec": {',
        '    "includedNamespaces": [',
        '      "shop"',
        "    ],",
        '    "storageLocation": "default",',
        '    "ttl": "48h0m0s"',
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("is not made of a name the API server refuses, or of a template the release refuses", () => {
    expect(backupFromForm("velero", "Shop", { storageLocation: "default" })).toBeUndefined();
    expect(backupFromForm("velero", "a".repeat(217), { storageLocation: "default" })).toBeUndefined();
    expect(backupFromForm("velero", "shop", { storageLocation: "default", ttl: "0s" })).toBeUndefined();
  });

  it("is read back from its text, and nothing is read of a text that is not one", () => {
    const body = backupFromForm("velero", "shop", { storageLocation: "default" });

    expect(body && readFormBody(formBodyText(body))).toEqual(body);
    expect(readFormBody("{")).toBeUndefined();
    expect(readFormBody(JSON.stringify({ kind: "Restore", metadata: {}, spec: {} }))).toBeUndefined();
  });
});
