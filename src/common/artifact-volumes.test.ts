import { describe, expect, it } from "vitest";
import { syntheticVolumeInfo } from "../../e2e/scripts/local-artifacts.mts";
import {
  bytesText,
  claimNamespace,
  detailsOf,
  EMPTY,
  markText,
  NO_DETAILS,
  NO_FIELDS,
  NOT_STATED,
  notWritten,
  OTHER_FIELDS,
  otherShape,
  parseVolumes,
  sizeText,
  skippedReason,
  volumesCount,
} from "./artifact-volumes";

// Entries as the reviewed release writes them, one of each method.
const NATIVE = {
  pvcName: "data",
  pvcNamespace: "shop",
  pvName: "pv-1",
  backupMethod: "NativeSnapshot",
  snapshotDataMoved: false,
  preserveLocalSnapshot: false,
  skipped: false,
  startTimestamp: "2026-10-04T10:00:00Z",
  completionTimestamp: "2026-10-04T10:01:00Z",
  result: "succeeded",
  nativeSnapshotInfo: {
    snapshotHandle: "snap-1",
    volumeType: "gp3",
    volumeAZ: "eu-west-1a",
    iops: "3000",
    Phase: "Completed",
  },
  pvInfo: { reclaimPolicy: "Delete", labels: { tier: "data", zone: "a" } },
};
const POD = {
  pvcName: "cache",
  pvcNamespace: "shop",
  pvName: "pv-2",
  backupMethod: "PodVolumeBackup",
  snapshotDataMoved: false,
  preserveLocalSnapshot: false,
  skipped: false,
  result: "failed",
  pvbInfo: {
    snapshotHandle: "kopia-1",
    size: 2048,
    uploaderType: "kopia",
    volumeName: "cache",
    podName: "cart-0",
    podNamespace: "shop",
    nodeName: "node-1",
    Phase: "Failed",
  },
};
const CSI = {
  pvcName: "ledger",
  pvcNamespace: "billing",
  pvName: "pv-3",
  backupMethod: "CSISnapshot",
  snapshotDataMoved: true,
  preserveLocalSnapshot: true,
  skipped: false,
  result: "succeeded",
  csiSnapshotInfo: {
    snapshotHandle: "csi-1",
    size: 1073741824,
    driver: "ebs.csi.aws.com",
    vscName: "vsc-1",
    ReadyToUse: true,
  },
  snapshotDataMovementInfo: {
    dataMover: "velero",
    uploaderType: "kopia",
    retainedSnapshot: "csi-1",
    snapshotHandle: "moved-1",
    operationID: "du-1",
    size: 524288,
    Phase: "Completed",
  },
};
const SKIPPED = {
  pvName: "pv-4",
  snapshotDataMoved: false,
  preserveLocalSnapshot: false,
  skipped: true,
  skippedReason: "CSI: skipped since PV is not bound to a PVC",
};

describe("the volume information of an operation", () => {
  it("reads one row for each volume of a backup, in the order it is written, with what the entry says of it", () => {
    const rows = parseVolumes(JSON.stringify([NATIVE, POD, CSI, SKIPPED]), "Backup");

    expect(rows).toHaveLength(4);
    expect(rows?.[0]).toMatchObject({
      claim: "data",
      namespace: "shop",
      volume: "pv-1",
      method: { text: "NativeSnapshot", known: true },
      result: { text: "succeeded", known: true },
      moved: false,
      kept: false,
      skipped: false,
      start: "2026-10-04T10:00:00Z",
      end: "2026-10-04T10:01:00Z",
      others: [],
    });
    expect(rows?.[1]).toMatchObject({
      method: { text: "PodVolumeBackup", known: true },
      result: { text: "failed", known: true },
    });
    expect(rows?.[2]).toMatchObject({ method: { text: "CSISnapshot", known: true }, moved: true, kept: true });
    // A volume that was skipped has neither a method nor a result, and says why.
    expect(rows?.[3]).toMatchObject({
      volume: "pv-4",
      skipped: true,
      reason: "CSI: skipped since PV is not bound to a PVC",
    });
    expect(rows?.[3]).not.toHaveProperty("method");
    expect(rows?.[3]).not.toHaveProperty("result");
    expect(rows?.[3]).not.toHaveProperty("claim");
    expect(rows?.[3].details).toEqual([]);
  });

  it("reads the size from the detail the entry carries, and none where no detail has one", () => {
    const rows = parseVolumes(JSON.stringify([NATIVE, POD, CSI, SKIPPED]), "Backup");

    // A native snapshot carries no size; a pod volume its own; a snapshot whose data was moved, the one
    // of what was moved before the one of the snapshot.
    expect(rows?.map((row) => row.size)).toEqual([undefined, 2048, 524288, undefined]);
    const alone = { ...CSI, snapshotDataMoved: false, snapshotDataMovementInfo: undefined };

    expect(parseVolumes(JSON.stringify([alone]), "Backup")?.[0].size).toBe(1073741824);
    // A size of zero is what the release writes for one it does not know: it is not shown as a size.
    const zero = { ...CSI, csiSnapshotInfo: { ...CSI.csiSnapshotInfo, size: 0 }, snapshotDataMovementInfo: undefined };

    expect(parseVolumes(JSON.stringify([zero]), "Backup")?.[0].size).toBeUndefined();
    const moved = { ...CSI, snapshotDataMovementInfo: { ...CSI.snapshotDataMovementInfo, size: 0 } };

    expect(parseVolumes(JSON.stringify([moved]), "Backup")?.[0].size).toBe(1073741824);
    // A size that is not written as a number is no size, whatever a number could be made of it: it is
    // a field of its detail, shown as it is written.
    for (const size of ["2048", true, [4096], null]) {
      const row = parseVolumes(JSON.stringify([{ ...POD, pvbInfo: { ...POD.pvbInfo, size } }]), "Backup")?.[0];

      expect([size, row?.size]).toEqual([size, undefined]);
      expect(row?.details[0].fields.find((field) => field.name === "size")?.value).toBe(
        typeof size === "string" ? size : JSON.stringify(size),
      );
    }
  });

  it("leaves out what an entry writes empty, as the release leaves it out: it is what the entry does not state", () => {
    const rows = parseVolumes(
      JSON.stringify([
        {
          pvcName: "",
          pvcNamespace: "",
          pvName: "pv-4",
          backupMethod: "",
          result: "",
          skipped: true,
          skippedReason: "",
          startTimestamp: "",
          completionTimestamp: "",
        },
      ]),
      "Backup",
    );

    expect(rows).toEqual([{ volume: "pv-4", skipped: true, details: [], others: [] }]);
    // And of a restore, its method.
    expect(parseVolumes(JSON.stringify([{ pvName: "", restoreMethod: "" }]), "Restore")).toEqual([
      { details: [], others: [] },
    ]);
  });

  it("reads the details of an entry, each field by its name, the ones written without a JSON name among them", () => {
    const rows = parseVolumes(JSON.stringify([NATIVE, POD, CSI]), "Backup");

    expect(rows?.[0].details).toEqual([
      {
        key: "nativeSnapshotInfo",
        title: "Native snapshot",
        fields: [
          { name: "snapshotHandle", value: "snap-1" },
          { name: "volumeType", value: "gp3" },
          { name: "volumeAZ", value: "eu-west-1a" },
          { name: "iops", value: "3000" },
          { name: "Phase", value: "Completed" },
        ],
      },
      {
        key: "pvInfo",
        title: "Volume",
        fields: [
          { name: "reclaimPolicy", value: "Delete" },
          // A map of labels is written as its pairs.
          { name: "labels", value: "tier=data, zone=a" },
        ],
      },
    ]);
    expect(rows?.[1].details.map((detail) => [detail.key, detail.title])).toEqual([["pvbInfo", "Pod volume backup"]]);
    expect(rows?.[1].details[0].fields).toContainEqual({ name: "size", value: "2048" });
    expect(rows?.[1].details[0].fields).toContainEqual({ name: "Phase", value: "Failed" });
    // The details in the order the tab names them, whatever the order they are written in.
    expect(rows?.[2].details.map((detail) => detail.title)).toEqual(["CSI snapshot", "Data movement"]);
    expect(rows?.[2].details[0].fields).toContainEqual({ name: "ReadyToUse", value: "true" });
    // A field the tab does not know is shown by its name and its value, whatever its value is.
    const more = {
      ...NATIVE,
      nativeSnapshotInfo: { ...NATIVE.nativeSnapshotInfo, encrypted: true, tags: ["a", "b"], cost: null },
    };

    expect(parseVolumes(JSON.stringify([more]), "Backup")?.[0].details[0].fields.slice(5)).toEqual([
      { name: "encrypted", value: "true" },
      { name: "tags", value: '["a","b"]' },
      { name: "cost", value: "null" },
    ]);
  });

  it("reads the volumes of a restore, with the way each was restored and no result", () => {
    const rows = parseVolumes(
      JSON.stringify([
        {
          pvcName: "cache",
          pvcNamespace: "shop",
          pvName: "pv-9",
          restoreMethod: "PodVolumeRestore",
          snapshotDataMoved: false,
          pvrInfo: {
            snapshotHandle: "kopia-1",
            size: 4096,
            uploaderType: "kopia",
            volumeName: "cache",
            podName: "cart-0",
            podNamespace: "shop",
          },
        },
        { pvcName: "data", pvcNamespace: "shop", restoreMethod: "CSISnapshot", snapshotDataMoved: true },
      ]),
      "Restore",
    );

    expect(rows?.[0]).toMatchObject({ method: { text: "PodVolumeRestore", known: true }, moved: false, size: 4096 });
    expect(rows?.[0].details.map((detail) => detail.title)).toEqual(["Pod volume restore"]);
    expect(rows?.[1]).toMatchObject({ method: { text: "CSISnapshot", known: true }, moved: true });
    for (const row of rows ?? []) {
      expect(row).not.toHaveProperty("result");
      expect(row).not.toHaveProperty("kept");
      expect(row).not.toHaveProperty("skipped");
    }
    // How a volume ended is what the release writes of a backup: of a restore it is a field the tab does
    // not know, shown by its name and its value.
    expect(
      parseVolumes(
        JSON.stringify([
          { pvcName: "old", restoreMethod: "NativeSnapshot", snapshotDataMoved: false, result: "failed" },
        ]),
        "Restore",
      ),
    ).toEqual([
      {
        claim: "old",
        method: { text: "NativeSnapshot", known: true },
        moved: false,
        details: [],
        others: [{ name: "result", value: "failed" }],
      },
    ]);
    // The method of a backup is not one of a restore, and the other way round: each is read from its key.
    expect(
      parseVolumes(JSON.stringify([{ backupMethod: "NativeSnapshot", snapshotDataMoved: false }]), "Restore")?.[0],
    ).toMatchObject({
      others: [{ name: "backupMethod", value: "NativeSnapshot" }],
    });
  });

  it("keeps the text of a method and of a result the release does not write, marked as not known", () => {
    const rows = parseVolumes(
      JSON.stringify([
        { ...NATIVE, backupMethod: "FileSystemClone", result: "partial" },
        { ...NATIVE, backupMethod: "PodVolumeRestore" },
      ]),
      "Backup",
    );

    expect(rows?.[0]).toMatchObject({
      method: { text: "FileSystemClone", known: false },
      result: { text: "partial", known: false },
    });
    // The method of a restore is not one a backup has.
    expect(rows?.[1].method).toEqual({ text: "PodVolumeRestore", known: false });
  });

  it("shows by its name and its value a field of an entry the tab does not know", () => {
    const rows = parseVolumes(
      JSON.stringify([{ ...NATIVE, encryption: "aws:kms", attempts: 2, hints: { a: 1 } }]),
      "Backup",
    );

    expect(rows?.[0].others).toEqual([
      { name: "encryption", value: "aws:kms" },
      { name: "attempts", value: "2" },
      { name: "hints", value: '{"a":1}' },
    ]);
  });

  it("reads an operation with no volume as an empty list", () => {
    expect(parseVolumes("[]", "Backup")).toEqual([]);
    expect(parseVolumes("[]", "Restore")).toEqual([]);
  });

  it("answers nothing for what is not of the shape of the release, and raises nothing", () => {
    for (const written of [
      "",
      "not JSON",
      "{}",
      "null",
      "3",
      "[1]",
      "[null]",
      '["pv-1"]',
      "[[]]",
      // What the release writes as a text, a mark or an object, and is not one.
      '[{"pvcName":3}]',
      '[{"backupMethod":true}]',
      '[{"skipped":"yes"}]',
      '[{"snapshotDataMoved":1}]',
      '[{"startTimestamp":1759572000}]',
      '[{"csiSnapshotInfo":"csi-1"}]',
      '[{"pvInfo":null}]',
      '[{"pvbInfo":[]}]',
    ])
      expect([written, parseVolumes(written, "Backup")]).toEqual([written, undefined]);
  });

  it("answers nothing, and raises nothing, for a value the runtime reads and cannot write back as text", () => {
    // Lists nested two hundred thousand deep under a numeric key: the runtime reads them without
    // recursion, and writes them back as JSON with it, in the unit tests and in the host alike. A file
    // of four hundred kilobytes Velero does not write, which a store can hold all the same.
    const deep = `{"0":${"[".repeat(200_000)}${"]".repeat(200_000)}}`;

    for (const written of [
      // A field of an entry the tab does not know, and a field of a detail.
      `[{"pvName":"pv-1","backupMethod":"NativeSnapshot","extra":${deep}}]`,
      `[{"pvName":"pv-1","backupMethod":"NativeSnapshot","nativeSnapshotInfo":{"iops":${deep}}}]`,
    ]) {
      expect(() => JSON.parse(written)).not.toThrow();
      expect(() => JSON.stringify(JSON.parse(written))).toThrow(RangeError);
      let read: unknown = "not read";

      expect(() => {
        read = parseVolumes(written, "Backup");
      }).not.toThrow();
      expect(read).toBeUndefined();
    }
  });
});

describe("the words of the volumes", () => {
  it("say a mark of an entry in words, and that an entry does not say it", () => {
    expect(NOT_STATED).toBe("Not stated");
    expect([markText(true), markText(false), markText(undefined)]).toEqual(["Yes", "No", "Not stated"]);
  });

  it("say a size in the unit that reads best", () => {
    expect(
      [1, 512, 1023, 1024, 2048, 1536, 524288, 1048576, 1073741824, 5 * 1024 ** 4, 3 * 1024 ** 5].map(sizeText),
    ).toEqual([
      "1 B",
      "512 B",
      "1023 B",
      "1.0 KiB",
      "2.0 KiB",
      "1.5 KiB",
      "512.0 KiB",
      "1.0 MiB",
      "1.0 GiB",
      "5.0 TiB",
      "3.0 PiB",
    ]);
    // A size that would be written as 1024.0 of a unit is one of the unit above.
    expect([1048575, 1073741823].map(sizeText)).toEqual(["1.0 MiB", "1.0 GiB"]);
    // The largest unit holds whatever is above it.
    expect(sizeText(2048 * 1024 ** 5)).toBe("2048.0 PiB");
    // The bytes as they are counted are what is read by who points at a size.
    expect([1, 2048, 1073741824].map(bytesText)).toEqual(["1 byte", "2048 bytes", "1073741824 bytes"]);
  });

  it("say how many volumes Velero recorded, and that it recorded none, in the words of the kind", () => {
    expect(volumesCount(4, "Backup")).toBe("Velero recorded 4 volumes for this backup.");
    expect(volumesCount(1, "Backup")).toBe("Velero recorded 1 volume for this backup.");
    expect(volumesCount(2, "Restore")).toBe("Velero recorded 2 volumes for this restore.");
    expect(volumesCount(0, "Backup")).toBe("Velero recorded no volume for this backup.");
    expect(volumesCount(0, "Restore")).toBe("Velero recorded no volume for this restore.");
  });

  it("say what is not known of a method and of a result the release does not write", () => {
    expect(notWritten("method")).toBe("Not a method of the reviewed release");
    expect(notWritten("result")).toBe("Not a result of the reviewed release");
  });

  it("say that a text is not of the shape the extension was written for", () => {
    expect(otherShape("Backup")).toBe(
      "The volume information of this backup is not of the shape the extension was written for: it is shown as the text it is.",
    );
    expect(otherShape("Restore")).toContain("of this restore is not of the shape the extension was written for");
  });

  it("name the details of a row by its volume, by its claim, or by its place in the list", () => {
    const rows = parseVolumes(
      JSON.stringify([NATIVE, { pvcName: "cache", pvcNamespace: "shop" }, { pvcName: "ledger" }, {}]),
      "Backup",
    );

    expect(rows?.map(detailsOf)).toEqual([
      "Details of the volume pv-1",
      "Details of the volume of the claim shop/cache",
      "Details of the volume of the claim ledger",
      "Details of volume 4",
    ]);
  });

  it("say that an entry carries no details, and what its other fields are", () => {
    expect(NO_DETAILS).toBe("The entry of this volume carries no details.");
    expect(OTHER_FIELDS).toBe("Other fields of the entry");
    expect(NO_FIELDS).toBe("It is written with no field.");
    expect(EMPTY).toBe("Empty");
  });

  it("say the namespace of a claim, and that the entry names a claim without one", () => {
    const rows = parseVolumes(
      JSON.stringify([
        NATIVE,
        { pvcName: "cache" },
        { pvcNamespace: "shop" },
        SKIPPED,
        { pvcName: "a", pvcNamespace: "" },
      ]),
      "Backup",
    );

    // An entry that names neither a claim nor a namespace says nothing under the claim.
    expect(rows?.map(claimNamespace)).toEqual([
      "in shop",
      "Namespace not stated",
      "in shop",
      undefined,
      "Namespace not stated",
    ]);
  });

  it("say why a volume was skipped, and that an entry that skipped one states no reason", () => {
    const rows = parseVolumes(
      JSON.stringify([
        SKIPPED,
        { skipped: true },
        { skipped: false },
        {},
        // A reason is shown wherever it is written, whatever the entry says of the skip.
        { skipped: false, skippedReason: "not selected" },
        { skippedReason: "not selected" },
      ]),
      "Backup",
    );

    expect(rows?.map(skippedReason)).toEqual([
      "CSI: skipped since PV is not bound to a PVC",
      "No reason stated",
      undefined,
      undefined,
      "not selected",
      "not selected",
    ]);
  });
});

// The volume information the fixtures give the store for the two backups its sync creates, made as the fixtures
// make it for the moment they were started, which the times of the volumes are counted from.
describe("the volume information of the backups the store is given for the tabs", () => {
  const started = Date.parse("2026-10-05T10:00:00.000Z");
  const full = syntheticVolumeInfo(started);
  // A field of a detail as the tab shows it: a text as it is, a map of texts as its pairs, anything else as the
  // JSON it is written as.
  const shown = (value: unknown) => {
    if (typeof value === "string") return value;
    if (value !== null && typeof value === "object")
      return Object.entries(value)
        .map(([key, entry]) => `${key}=${entry}`)
        .join(", ");
    return JSON.stringify(value);
  };

  it("reads one row for each volume of the first, with what its entry says and the size of the detail that has one", () => {
    const rows = parseVolumes(full.text, "Backup");

    if (!rows) throw new Error("The volume information the fixtures give the store is not read");
    expect(
      rows.map((row) => [
        row.claim,
        row.namespace,
        row.volume,
        row.method,
        row.result,
        row.moved,
        row.kept,
        row.skipped,
        row.reason,
        row.start,
        row.end,
        row.size,
      ]),
    ).toEqual(
      full.value.map((volume) => [
        volume.pvcName,
        volume.pvcNamespace,
        volume.pvName,
        volume.backupMethod && { text: volume.backupMethod, known: true },
        volume.result && { text: volume.result, known: true },
        volume.snapshotDataMoved,
        volume.preserveLocalSnapshot,
        volume.skipped,
        volume.skippedReason,
        volume.startTimestamp,
        volume.completionTimestamp,
        // A native snapshot has no size, and a volume that was skipped no detail of one.
        volume.csiSnapshotInfo?.size ?? volume.pvbInfo?.size,
      ]),
    );
    // The details of each entry, each field by the name it is written with and in its order, `ReadyToUse` and
    // `Phase` among them, and no field the tab does not know.
    expect(rows.map((row) => [row.details.map((detail) => [detail.key, detail.fields]), row.others])).toEqual(
      full.value.map((volume) => [
        Object.entries(volume)
          .filter(([key]) => key.endsWith("Info"))
          .map(([key, detail]) => [
            key,
            Object.entries(detail as object).map(([name, value]) => ({ name, value: shown(value) })),
          ]),
        [],
      ]),
    );
    expect(volumesCount(rows.length, "Backup")).toBe(`Velero recorded ${full.value.length} volumes for this backup.`);
  });

  it("reads the volume information of the second as no volume", () => {
    const rows = parseVolumes(syntheticVolumeInfo(started, "empty").text, "Backup");

    expect(rows).toEqual([]);
    expect(volumesCount(rows?.length ?? -1, "Backup")).toBe("Velero recorded no volume for this backup.");
  });
});
