// The DeleteBackupRequest of one backup against the one `velero backup delete` of the reviewed release makes, kept as a
// golden written from its source (SPEC-0017, DELETE-02), and its text, written once and read back only as it was
// written.

import { describe, expect, it } from "vitest";
import goldens from "../../test/delete-backup-request.goldens.json";
import {
  BACKUP_NAME_LABEL,
  BACKUP_UID_LABEL,
  deleteRequestOf,
  deleteRequestText,
  readDeleteRequest,
} from "./delete-request";

const BACKUP = { name: "nightly-20261108030000", uid: "0b6f0c3e-8a4c-4f1e-9d6a-2f6b7c8d9e01" };

describe("the DeleteBackupRequest of one backup", () => {
  it.each(Object.entries(goldens.cases))(
    "is the request `velero backup delete` makes: %s",
    (_, { namespace, backup, request }) => {
      expect(deleteRequestOf(namespace, backup)).toEqual(request);
      expect(JSON.parse(deleteRequestText(deleteRequestOf(namespace, backup)))).toEqual(request);
      expect(readDeleteRequest(deleteRequestText(deleteRequestOf(namespace, backup)))).toEqual({ namespace, backup });
    },
  );

  it("names the backup whole, and cuts only the label of its name, as the release cuts the label of a name", () => {
    const long = goldens.cases["of-a-schedule"];
    const request = deleteRequestOf(long.namespace, long.backup);

    expect(request.spec.backupName).toHaveLength(70);
    expect(request.metadata.generateName).toBe(`${long.backup.name}-`);
    expect(request.metadata.labels[BACKUP_NAME_LABEL]).toHaveLength(63);
    expect(request.metadata.labels[BACKUP_UID_LABEL]).toBe(long.backup.uid);
    expect(Object.keys(request.metadata.labels)).toEqual([BACKUP_NAME_LABEL, BACKUP_UID_LABEL]);
  });

  it("is written once, the same request always the same text, with two spaces and the keys in a fixed order", () => {
    expect(deleteRequestText(deleteRequestOf("velero", BACKUP))).toBe(
      [
        "{",
        '  "apiVersion": "velero.io/v1",',
        '  "kind": "DeleteBackupRequest",',
        '  "metadata": {',
        '    "namespace": "velero",',
        '    "labels": {',
        '      "velero.io/backup-name": "nightly-20261108030000",',
        '      "velero.io/backup-uid": "0b6f0c3e-8a4c-4f1e-9d6a-2f6b7c8d9e01"',
        "    },",
        '    "generateName": "nightly-20261108030000-"',
        "  },",
        '  "spec": {',
        '    "backupName": "nightly-20261108030000"',
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("reads back the text of a request only as it was written, byte for byte", () => {
    const text = deleteRequestText(deleteRequestOf("velero", BACKUP));
    const request = JSON.parse(text) as Record<string, unknown> & {
      metadata: Record<string, unknown> & { labels: Record<string, string> };
      spec: Record<string, unknown>;
    };
    const written = (value: unknown) => JSON.stringify(value, null, 2);

    expect(readDeleteRequest(text)).toEqual({ namespace: "velero", backup: BACKUP });
    for (const other of [
      "",
      "not json",
      "null",
      "[]",
      '"text"',
      // The same request written otherwise.
      JSON.stringify(request),
      `${text}\n`,
      ` ${text}`,
      written({ kind: request.kind, apiVersion: request.apiVersion, metadata: request.metadata, spec: request.spec }),
      // Another request, or one with more than the release writes.
      written({ ...request, apiVersion: "velero.io/v2alpha1" }),
      written({ ...request, kind: "Backup" }),
      written({ ...request, metadata: { ...request.metadata, name: "nightly-20261108030000-abcde" } }),
      written({ ...request, metadata: { ...request.metadata, generateName: "proof-delete-" } }),
      written({ ...request, metadata: { ...request.metadata, annotations: { note: "kept" } } }),
      written({ ...request, metadata: { ...request.metadata, labels: { ...request.metadata.labels, app: "web" } } }),
      written({
        ...request,
        metadata: { ...request.metadata, labels: { ...request.metadata.labels, [BACKUP_NAME_LABEL]: "weekly" } },
      }),
      written({ ...request, spec: { backupName: "weekly" } }),
      written({ ...request, status: { phase: "New" } }),
      // A request that names no backup, no UID or no namespace.
      written({ ...request, spec: {} }),
      written({ ...request, spec: { backupName: "" } }),
      written({ ...request, metadata: { ...request.metadata, labels: { [BACKUP_NAME_LABEL]: BACKUP.name } } }),
      written({ ...request, metadata: { ...request.metadata, namespace: "" } }),
      // The text of a request of no backup, of no UID or of no namespace, as the builder would write it.
      deleteRequestText(deleteRequestOf("velero", { name: "", uid: BACKUP.uid })),
      deleteRequestText(deleteRequestOf("velero", { name: BACKUP.name, uid: "" })),
      deleteRequestText(deleteRequestOf("", BACKUP)),
    ])
      expect(readDeleteRequest(other), other.slice(0, 60)).toBeUndefined();
  });
});
