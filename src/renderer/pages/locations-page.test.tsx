// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listProps } from "../../../test/host-components";
import { emptyPreferences, RESOURCES } from "../../common/discovery";
import { REFUSED_WHEN_NOT_AVAILABLE } from "../../common/location-users";
import { LEFT_OUT, SNAPSHOT_PHASE_NOTE } from "../../common/location-view";
import { BackupStorageLocation, VolumeSnapshotLocation } from "../api/kinds";
import { SnapshotLocationDetails } from "../details/snapshot-location-details";
import { StorageLocationDetails } from "../details/storage-location-details";
import { closeViews, openView, openViews } from "../navigation";
import { Installation } from "../state/installation";
import { BackupsPage } from "./backups-page";
import { SchedulesPage } from "./schedules-page";
import { SnapshotLocationsPage } from "./snapshot-locations-page";
import { StorageLocationsPage } from "./storage-locations-page";

import type { Renderer } from "@freelensapp/extensions";

import type { Answer, Family, Preferences } from "../../common/discovery";

const DISCOVERY = "/apis/velero.io/v1";
const LOCATIONS = "/apis/velero.io/v1/backupstoragelocations";
const A = "velero-a";
const B = "velero-b";
const NOW = Date.parse("2026-09-10T12:00:00Z");
const shown = (time: string) => new Date(time).toLocaleString();
const LATE_BY_THE_HOUR =
  "The availability may be out of date: the last validation is older than one hour, by the clock of this machine.";

type Answers = Record<string, Answer | (() => Promise<Answer>)>;

function path(family: Family, namespace: string): string {
  return `/apis/velero.io/v1/namespaces/${namespace}/${RESOURCES[family]}`;
}

function list(...items: unknown[]): Answer {
  return { status: 200, body: { items } };
}

function object(
  kind: string,
  name: string,
  namespace: string,
  spec?: object,
  status?: object,
  more: { labels?: Record<string, string>; created?: string; uid?: string } = {},
) {
  return {
    apiVersion: "velero.io/v1",
    kind,
    metadata: {
      name,
      namespace,
      uid: more.uid ?? `${namespace}-${kind.toLowerCase()}-${name}`,
      resourceVersion: "1",
      creationTimestamp: more.created ?? "2026-08-01T00:00:00Z",
      ...(more.labels ? { labels: more.labels } : {}),
    },
    ...(spec ? { spec } : {}),
    ...(status ? { status } : {}),
  };
}

// The one Velero validates every minute, as it does on an installation that is at work.
const main = object(
  "BackupStorageLocation",
  "default",
  A,
  {
    provider: "aws",
    default: true,
    accessMode: "ReadWrite",
    objectStorage: { bucket: "backups", prefix: "prod", caCertRef: { name: "storage-ca", key: "ca.crt" } },
    config: {
      region: "us-east-1",
      s3Url: "https://reader:secret@s3.example.test:9000/store?token=abc",
      insecureSkipTLSVerify: "true",
    },
    credential: { name: "cloud-credentials", key: "cloud" },
    validationFrequency: "1m0s",
    backupSyncPeriod: "1m0s",
  },
  {
    phase: "Available",
    lastValidationTime: "2026-09-10T11:59:30Z",
    lastSyncedTime: "2026-09-10T11:59:00Z",
    // Deprecated and unused in the reviewed release: it is not the access mode.
    accessMode: "ReadOnly",
  },
);
// Available when it was last looked at, which is two days ago, and read only.
const archive = object(
  "BackupStorageLocation",
  "archive",
  A,
  { provider: "aws", accessMode: "ReadOnly", objectStorage: { bucket: "archive" } },
  { phase: "Available", lastValidationTime: "2026-09-08T12:00:00Z" },
);
const broken = object(
  "BackupStorageLocation",
  "broken",
  A,
  {
    provider: "gcp",
    objectStorage: { bucket: "gone", caCert: "QUJDRA==" },
    config: { insecureSkipTLSVerify: "true" },
    validationFrequency: "0s",
    backupSyncPeriod: "0s",
  },
  {
    phase: "Unavailable",
    message: "the bucket does not exist\nand the second line says where it was looked for",
    lastValidationTime: "2026-09-10T11:30:00Z",
  },
);
const silent = object("BackupStorageLocation", "silent", A, { provider: "aws" });
// As long as a name, a bucket and a prefix can be: 63 characters each, and a prefix of many parts.
const LONG = "location-with-a-name-as-long-as-the-name-of-an-object-can-be-63";
const LONG_BUCKET = "bucket-with-a-name-as-long-as-the-name-of-a-bucket-can-be-in-s3";
const LONG_PREFIX = "clusters/production/europe/south/first/velero/backups/of/every/namespace/kept/for/a/year";
const long = object(
  "BackupStorageLocation",
  LONG,
  A,
  { provider: "aws", objectStorage: { bucket: LONG_BUCKET, prefix: LONG_PREFIX }, validationFrequency: "1m0s" },
  // Ten minutes old, with a frequency of one minute: later than three times the frequency.
  { phase: "Available", lastValidationTime: "2026-09-10T11:50:00Z" },
);
const quoting = object(
  "BackupStorageLocation",
  "quoting",
  A,
  { provider: "aws", validationFrequency: "soon", backupSyncPeriod: "-1m" },
  {
    phase: "Unavailable",
    message: 'Get "https://reader:secret@s3.example.test/store?token=abc": no such host',
    lastValidationTime: "2026-09-10T11:59:50Z",
  },
);
const odd = object("BackupStorageLocation", "odd", A, { accessMode: "WriteOnce" }, { phase: "Degraded" });
const snapshots = object("VolumeSnapshotLocation", "snapshots", A, {
  provider: "aws",
  config: { region: "us-east-1", insecureSkipTLSVerify: "true" },
  credential: { name: "snapshot-credentials", key: "cloud" },
});
const claimed = object("VolumeSnapshotLocation", "claimed", A, { provider: "csi" }, { phase: "Available" });
const ran = (date: string, phase = "Completed", errors = 0) => ({
  phase,
  startTimestamp: `${date}T01:00:00Z`,
  ...(phase === "InProgress" ? {} : { completionTimestamp: `${date}T01:04:00Z` }),
  // The release writes no counter of zero.
  ...(errors ? { errors } : {}),
});
const to = (storageLocation: string, volumeSnapshotLocations: string[] = []) => ({
  includedNamespaces: ["shop"],
  storageLocation,
  ...(volumeSnapshotLocations.length ? { volumeSnapshotLocations } : {}),
});
const backups = [
  object("Backup", "b-1", A, to("default", ["snapshots"]), ran("2026-09-07")),
  object("Backup", "b-2", A, to("default"), ran("2026-09-08", "PartiallyFailed", 2)),
  object("Backup", "b-3", A, to("default", ["snapshots"]), ran("2026-09-09", "InProgress")),
  // The newest of the ones sent to the location that is not available: refused, with no start time.
  object(
    "Backup",
    "b-refused",
    A,
    to("broken"),
    { phase: "FailedValidation", validationErrors: ["the location is unavailable"] },
    { created: "2026-09-10T01:00:00Z" },
  ),
  object("Backup", "b-old", A, to("broken"), ran("2026-09-01")),
  object("Backup", "elsewhere", B, to("default"), ran("2026-09-09")),
];
const schedules = [
  object(
    "Schedule",
    "nightly",
    A,
    { schedule: "0 3 * * *", skipImmediately: false, template: to("default", ["snapshots"]) },
    { phase: "Enabled" },
  ),
  object(
    "Schedule",
    "hourly",
    A,
    { schedule: "0 * * * *", skipImmediately: false, template: to("default") },
    { phase: "Enabled" },
  ),
  object(
    "Schedule",
    "weekly",
    A,
    { schedule: "0 4 * * 0", skipImmediately: false, template: to("archive") },
    { phase: "Enabled" },
  ),
];
const served: Answer = { status: 200, body: { resources: Object.values(RESOURCES).map((name) => ({ name })) } };

function answers(more: Answers = {}): Answers {
  return {
    [DISCOVERY]: served,
    [LOCATIONS]: list({ metadata: { name: "default", namespace: A } }, { metadata: { name: "default", namespace: B } }),
    [path("storageLocations", A)]: list(main, archive, broken, silent, odd),
    [path("storageLocations", B)]: list(
      object("BackupStorageLocation", "default", B, { default: true }, { phase: "Available" }),
    ),
    [path("snapshotLocations", A)]: list(snapshots, claimed),
    [path("snapshotLocations", B)]: list(),
    [path("backups", A)]: list(...backups.filter((backup) => backup.metadata.namespace === A)),
    [path("backups", B)]: list(...backups.filter((backup) => backup.metadata.namespace === B)),
    [path("schedules", A)]: list(...schedules),
    [path("schedules", B)]: list(),
    [path("restores", A)]: list(),
    [path("restores", B)]: list(),
    ...more,
  };
}

function mount(table: Answers, preferences: Preferences = emptyPreferences(), page = StorageLocationsPage) {
  const asked: string[] = [];
  const clock = { now: NOW };
  const installation = new Installation({
    cluster: { id: "cluster-a", name: "local-demo" },
    read: async (address) => {
      asked.push(address);
      const answer = table[address] ?? { status: 404 };

      return typeof answer === "function" ? answer() : answer;
    },
    now: () => clock.now,
    storage: { read: () => preferences, write: () => undefined },
  });
  const Page = page;
  const view = render(<Page installation={installation} />);

  return { installation, asked, clock, table, view };
}

const chosen = (namespace: string): Preferences => ({ selected: { "cluster-a": namespace }, configured: {} });
const STORAGE = "storage-location";
const SNAPSHOT = "snapshot-location";
const rows = (kind = STORAGE) =>
  [...document.querySelectorAll(`[data-${kind}-row]`)].map((row) => row.getAttribute(`data-${kind}-row`));
const row = (name: string, kind = STORAGE) =>
  screen.getByText(name, { selector: `[data-${kind}-row]` }).closest(".TableRow") as HTMLElement;
const cell = (name: string, column: string, kind = STORAGE) =>
  row(name, kind).querySelector(`.TableCell.${column}`)?.textContent;
const notice = (family: string) => screen.queryByTestId(`velero-notice-${family}`)?.textContent ?? "";
// What is said over a list, in words: the text beside the mark.
const notes = (id: string) =>
  screen.queryAllByTestId(`velero-${id}-note`).map((note) => note.querySelector("span")?.textContent);
const open = async (name: string, kind = STORAGE) => {
  await waitFor(() => expect(rows(kind)).toContain(name));
  fireEvent.click(screen.getByText(name, { selector: `[data-${kind}-row]` }));
  return screen.findByTestId(`velero-${kind}-workspace`);
};
const fact = (band: HTMLElement, name: string) => {
  const found = [...band.querySelectorAll<HTMLElement>("div")].filter(
    (element) => element.firstElementChild?.textContent === name && element.children.length >= 2,
  );

  if (found.length !== 1) throw new Error(`The fact ${name} is ${found.length} times in the band`);
  return { value: found[0].children[1].textContent, note: found[0].children[2]?.textContent };
};

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  act(() => closeViews());
  cleanup();
  listProps.clear();
  vi.useRealTimers();
});

describe("list of the backup storage locations", () => {
  it("gives the host a list that only reads, with the columns of the locations", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toEqual(["default", "archive", "broken", "silent", "odd"]));
    const props = listProps.get("veleroStorageLocationsTable") ?? {};
    const columns = props.renderTableHeader as { id: string; sortBy: string; className: string }[];

    expect(props.isSelectable).toBe(false);
    expect((props.renderItemMenu as () => unknown)()).toBeNull();
    expect(props.subscribeStores).toBe(false);
    for (const forbidden of ["onAdd", "addRemoveButtons", "renderFooter", "headerActions"]) {
      expect(props[forbidden]).toBeUndefined();
    }
    expect(columns.map((column) => column.id)).toEqual([
      "name",
      "namespace",
      "availability",
      "access",
      "marked",
      "provider",
      "validated",
      "synced",
    ]);
    expect(Object.keys(props.sortingCallbacks as object).sort()).toEqual(columns.map((column) => column.sortBy).sort());
    expect(screen.getByTestId("velero-storage-locations-page")).toBeTruthy();
  });

  it("is searched by what every column shows, and by the message of Velero", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(5));
    const props = listProps.get("veleroStorageLocationsTable") ?? {};
    const items = (props.getItems as () => { getName(): string }[])();
    const searched = (name: string) =>
      (props.searchFilters as ((item: unknown) => string[])[]).flatMap((filter) =>
        filter(items.find((item) => item.getName() === name)),
      );

    for (const column of ["installation", "access", "marked", "provider", "synced"]) {
      expect(cell("default", column)).not.toBe("");
      expect([column, searched("default")]).toEqual([column, expect.arrayContaining([cell("default", column)])]);
    }
    // The last validation by how long ago it was, which is what the cell shows, and by when it was.
    expect(cell("default", "validated")).toBe("30s ago");
    expect(searched("default")).toEqual(
      expect.arrayContaining(["default", "Available", "30s ago", shown("2026-09-10T11:59:30Z")]),
    );
    expect(searched("broken")).toEqual(
      expect.arrayContaining([
        "Unavailable",
        "the bucket does not exist\nand the second line says where it was looked for",
        "Never synced",
      ]),
    );
    expect(searched("archive")).toContain("2d ago, may be out of date");
    expect(searched("silent")).toEqual(expect.arrayContaining(["Not reported", "Never validated", "Not set"]));
    expect(searched("odd")).toEqual(expect.arrayContaining(["Degraded", "Unknown: Degraded", "WriteOnce"]));
    for (const name of ["default", "archive", "broken", "silent", "odd"]) expect(searched(name)).not.toContain("");
  });

  it("orders by what each column shows", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(5));
    const props = listProps.get("veleroStorageLocationsTable") ?? {};
    const items = (props.getItems as () => { getName(): string }[])();
    const order = (column: string) => {
      const by = (props.sortingCallbacks as Record<string, (item: unknown) => string | number>)[column];

      return [...items]
        .sort((one, other) => {
          const [first, second] = [by(one), by(other)];

          return first < second ? -1 : first > second ? 1 : 0;
        })
        .map((item) => item.getName());
    };

    // The one that is marked comes first, and the others stay as they were.
    expect(order("marked")[0]).toBe("default");
    // The ones that were never validated come before the oldest validation.
    expect(order("validated")).toEqual(["silent", "odd", "archive", "broken", "default"]);
    expect(order("synced").slice(-1)).toEqual(["default"]);
    expect(order("availability")).toEqual(["default", "archive", "silent", "broken", "odd"]);
  });

  it("says available of a reported Available, and of nothing else", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(5));
    const mark = (name: string) => {
      const found = row(name).querySelector("[data-availability]");

      return [found?.getAttribute("data-availability"), found?.getAttribute("data-mark"), cell(name, "phase")];
    };

    expect(mark("default")).toEqual(["available", "available", "check_circle_outlineAvailable"]);
    expect(mark("broken")).toEqual(["unavailable", "unavailable", "highlight_offUnavailable"]);
    // A location that reports nothing, and one that reports what the release does not know, have the mark
    // of what is not known: never the one of what is well.
    expect(mark("silent")).toEqual(["not-reported", "unknown", "help_outlineNot reported"]);
    expect(mark("odd")).toEqual(["unknown", "unknown", "help_outlineUnknown: Degraded"]);
    // What Velero says beside the phase is the tip of the mark, which is what the pointer is on.
    expect(row("broken").querySelector("[data-availability]")?.getAttribute("title")).toBe(
      "the bucket does not exist\nand the second line says where it was looked for",
    );
    expect(row("broken").querySelectorAll(".TableCell.phase [title]")).toHaveLength(1);
    expect(row("default").querySelector("[data-availability]")?.getAttribute("title")).toBe("Available");
  });

  it("keeps availability, access mode and default as three facts", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect([cell("archive", "phase"), cell("archive", "access"), cell("archive", "marked")]).toEqual([
      "check_circle_outlineAvailable",
      "Read only",
      "Not marked",
    ]);
    expect([cell("default", "access"), cell("default", "marked")]).toEqual(["Read and write", "Marked default"]);
    // The mode of the status is deprecated: the one of the location is the one of its spec.
    expect(row("default").querySelector("[data-access]")?.getAttribute("data-access")).toBe("ReadWrite");
    expect(cell("silent", "access")).toBe("Not set");
    expect(cell("odd", "access")).toBe("Unknown: WriteOnce");
  });

  it("says when a location was last validated, and that an old validation may not hold any more", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(5));
    const late = (name: string) => row(name).querySelector("[data-late]")?.getAttribute("data-late");

    expect(cell("default", "validated")).toBe("30s ago");
    expect(late("default")).toBe("false");
    // When it was is in the tip of the cell.
    expect(row("default").querySelector("[data-late]")?.getAttribute("title")).toBe(shown("2026-09-10T11:59:30Z"));
    // Two days old, with no frequency named: older than one hour.
    // A validation that is late has its mark, which is a shape, and its words for who does not see it;
    // the whole of it is in the tip.
    expect(cell("archive", "validated")).toBe("warning_amber2d ago, may be out of date");
    expect(late("archive")).toBe("true");
    expect(row("archive").querySelector("[data-late]")?.getAttribute("title")).toBe(
      `${shown("2026-09-08T12:00:00Z")}. ${LATE_BY_THE_HOUR}`,
    );
    expect(row("default").querySelector("[data-late] .Icon")).toBeNull();
    // The periodic validation is turned off, and the last one is half an hour old.
    expect(cell("broken", "validated")).toBe("30m ago");
    expect(late("broken")).toBe("false");
    expect(cell("silent", "validated")).toBe("Never validated");
    expect(cell("odd", "validated")).toBe("Never validated");
    expect(row("silent").querySelector("[data-late]")?.hasAttribute("title")).toBe(false);
    // The last sync by how long ago it was, with when it was in the tip.
    expect(cell("default", "synced")).toBe("1m ago");
    expect(row("default").querySelector(".TableCell.synced [title]")?.getAttribute("title")).toBe(
      shown("2026-09-10T11:59:00Z"),
    );
    expect(cell("archive", "synced")).toBe("Never synced");
  });

  it("says nothing over the list when one location is marked default", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(notes("storage-locations")).toEqual([]);
  });

  it("says nothing of the default of an installation before its locations are read", async () => {
    let answer: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });

    mount(
      answers({
        [path("storageLocations", A)]: async () => {
          await held;
          return list(archive, broken);
        },
      }),
      chosen(A),
    );
    // The list is there and was not read: that it holds no location marked default is not known yet.
    await screen.findByTestId("velero-storage-locations-not-counted");
    expect(rows()).toEqual([]);
    expect(notes("storage-locations")).toEqual([]);
    expect(document.body.textContent).not.toContain("is marked default");
    await act(async () => {
      answer();
      await held;
    });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(notes("storage-locations")).toHaveLength(1);
  });

  it("says that no location is marked default, and picks none", async () => {
    mount(answers({ [path("storageLocations", A)]: list(archive, broken) }), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(notes("storage-locations")).toEqual([
      "No storage location of this installation is marked default. The server of Velero may name one in its settings, which this view does not read.",
    ]);
    expect([cell("archive", "marked"), cell("broken", "marked")]).toEqual(["Not marked", "Not marked"]);
  });

  it("shows each location that is marked default when more than one is, and says which one the release keeps", async () => {
    const second = object(
      "BackupStorageLocation",
      "second",
      A,
      { default: true, accessMode: "ReadOnly" },
      { phase: "Available" },
      { created: "2026-08-20T00:00:00Z" },
    );

    mount(answers({ [path("storageLocations", A)]: list(main, second, archive) }), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect([cell("default", "marked"), cell("second", "marked"), cell("archive", "marked")]).toEqual([
      "Marked default",
      "Marked default",
      "Not marked",
    ]);
    expect(notes("storage-locations")).toEqual([
      "2 storage locations are marked default: default, second. The reviewed release sends a backup that names no location to the first of them it finds, and keeps marked the one created last, which is second.",
    ]);
  });

  it.each([
    ["denied", { status: 403 }, "Access to the backup storage locations of this namespace is denied"],
    ["not answered", {}, "could not be read"],
  ])("does not show a list that was %s as an empty one", async (_name, answer, text) => {
    mount(answers({ [path("storageLocations", A)]: answer as Answer }), chosen(A));
    const state = await screen.findByTestId("velero-storage-locations-unavailable");

    expect(state.textContent).toContain(text);
    expect(screen.queryByTestId("velero-storage-locations")).toBeNull();
    expect(notes("storage-locations")).toEqual([]);
    expect(document.body.textContent).not.toMatch(/\b0 items\b|No storage location of this installation is marked/);
  });

  it.each([
    ["backupstoragelocations", "storageLocations", "storage-locations", "backup storage locations"],
    ["volumesnapshotlocations", "snapshotLocations", "snapshot-locations", "volume snapshot locations"],
  ] as const)(
    "says that the cluster does not serve %s, which is not that there are none",
    async (resource, family, id, noun) => {
      const partly: Answer = {
        status: 200,
        body: {
          resources: Object.values(RESOURCES)
            .filter((name) => name !== resource)
            .map((name) => ({ name })),
        },
      };
      const { asked } = mount(
        answers({ [DISCOVERY]: partly }),
        chosen(A),
        family === "storageLocations" ? StorageLocationsPage : SnapshotLocationsPage,
      );
      const state = await screen.findByTestId(`velero-${id}-unavailable`);

      expect(state.textContent).toContain(`This cluster does not serve the ${noun} of Velero`);
      expect(asked).not.toContain(path(family, A));
      expect(notes(id)).toEqual([]);
      expect(screen.queryByTestId(`velero-${id}`)).toBeNull();
    },
  );

  it("does not show the answer of the installation that was selected before", async () => {
    let answer: (value: Answer) => void = () => undefined;
    const late = new Promise<Answer>((resolve) => {
      answer = resolve;
    });
    const { installation } = mount(answers({ [path("storageLocations", A)]: () => late }), chosen(A));

    await waitFor(() => expect(installation.namespace).toBe(A));
    fireEvent.change(await screen.findByLabelText("Velero namespace"), { target: { value: B } });
    await waitFor(() => expect(rows()).toEqual(["default"]));
    expect(cell("default", "marked")).toBe("Marked default");
    await act(async () => {
      answer(list(main, archive, broken, silent, odd));
      await late;
    });
    // The locations of the installation that was left are not the ones of the one that is shown.
    expect(rows()).toEqual(["default"]);
    expect(installation.read("storageLocations").items).toHaveLength(1);
    expect(notes("storage-locations")).toEqual([]);
  });

  it("shows a namespace with no location as a list with none", async () => {
    mount(answers({ [path("storageLocations", A)]: list() }), chosen(A));
    const empty = await screen.findByTestId("velero-storage-locations-empty");

    expect(empty.textContent).toContain(`No backup storage location is in the namespace ${A}`);
  });

  it("keeps the locations that were read when the next read fails, and says when they were read", async () => {
    const { installation, table, clock } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(5));
    const read = new Date(clock.now).toLocaleTimeString();

    clock.now += 60_000;
    table[path("storageLocations", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(rows()).toHaveLength(5);
    expect(notice("storageLocations")).toContain("could not be read");
    expect(notice("storageLocations")).toContain(`What is shown was read at ${read}`);
    // The backups are not what a row of this list is made from.
    table[path("storageLocations", A)] = list(main, archive, broken, silent, odd);
    table[path("backups", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(notice("storageLocations")).toBe("");
    expect(notice("backups")).toBe("");
  });

  it("stops asking when the view closes", async () => {
    vi.useFakeTimers();
    const { asked, view } = mount(answers(), chosen(A));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    const before = asked.length;

    expect(asked.filter((address) => address === path("storageLocations", A)).length).toBeGreaterThanOrEqual(2);
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(asked).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("workspace of a backup storage location", () => {
  it("shows what Velero says of the location, and the three facts apart", async () => {
    const { asked } = mount(answers(), chosen(A));

    await waitFor(() => expect(rows()).toHaveLength(5));
    const before = asked.length;
    const workspace = await open("default");
    const status = within(workspace).getByTestId("velero-storage-location-status");

    expect(status.querySelector("[data-availability]")?.getAttribute("data-mark")).toBe("available");
    expect(fact(status, "Availability")).toEqual({ value: "check_circle_outlineAvailable", note: undefined });
    expect(fact(status, "Last validation")).toEqual({
      value: `${shown("2026-09-10T11:59:30Z")} (30s ago)`,
      note: undefined,
    });
    expect(fact(status, "Access mode")).toEqual({ value: "Read and write", note: undefined });
    expect(fact(status, "Default")).toEqual({ value: "Marked default", note: undefined });
    expect(fact(status, "Last sync").value).toBe(`${shown("2026-09-10T11:59:00Z")} (1m ago)`);
    expect(fact(status, "Installation")).toEqual({ value: A, note: "Cluster local-demo" });
    expect(within(workspace).queryByTestId("velero-location-refused")).toBeNull();
    // Opening a location asks nothing of the cluster.
    expect(asked).toHaveLength(before);
    expect(document.activeElement).toBe(screen.getByTestId("velero-back"));
    expect(screen.getByTestId("velero-back").textContent).toContain("Backup Storage Locations");
  });

  it("shows the message of Velero beside a location that is unavailable, and what the release refuses", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("broken");
    const status = within(workspace).getByTestId("velero-storage-location-status");

    expect(fact(status, "Availability")).toEqual({
      value: "highlight_offUnavailable",
      note: "the bucket does not exist\nand the second line says where it was looked for",
    });
    expect(status.querySelector("[data-availability]")?.getAttribute("data-mark")).toBe("unavailable");
    expect(within(workspace).getByTestId("velero-location-refused").textContent).toBe(REFUSED_WHEN_NOT_AVAILABLE);
    expect(fact(status, "Last validation").value).toBe(`${shown("2026-09-10T11:30:00Z")} (30m ago)`);
    expect(fact(status, "Last sync").value).toBe("Never synced");
    const storage = within(workspace).getByTestId("velero-storage-location-storage");

    expect(fact(storage, "Validation frequency")).toEqual({
      value: "Turned off",
      note: "The periodic validation is turned off: the availability is the one of the last validation.",
    });
    expect(fact(storage, "Sync period").value).toBe("Turned off");
  });

  it("says that the availability may be out of date when the last validation is old", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("archive");
    const status = within(workspace).getByTestId("velero-storage-location-status");

    expect(fact(status, "Last validation")).toEqual({
      value: `${shown("2026-09-08T12:00:00Z")} (2d ago)`,
      note: "The availability may be out of date: the last validation is older than one hour, by the clock of this machine.",
    });
    expect(within(workspace).getByTestId("velero-location-validation").getAttribute("data-late")).toBe("true");
    // Available and read only are side by side, and the view says that new backups cannot go there.
    expect(fact(status, "Availability").value).toBe("check_circle_outlineAvailable");
    expect(fact(status, "Access mode")).toEqual({
      value: "Read only",
      note: "The location is available and read-only: it does not take new backups.",
    });
    expect(fact(within(workspace).getByTestId("velero-storage-location-storage"), "Validation frequency")).toEqual({
      value: "Not set",
      note: "The frequency is the one of the server of Velero, which this view does not read.",
    });
  });

  it("says which bound a validation is later than, and shows what is not a frequency as it is written", async () => {
    mount(answers({ [path("storageLocations", A)]: list(main, long, quoting) }), chosen(A));
    const workspace = await open(LONG);
    const status = within(workspace).getByTestId("velero-storage-location-status");

    expect(fact(status, "Last validation")).toEqual({
      value: `${shown("2026-09-10T11:50:00Z")} (10m ago)`,
      note: "The availability may be out of date: the last validation is older than 3 times the frequency, by the clock of this machine.",
    });
    fireEvent.click(screen.getByTestId("velero-back"));
    const other = await open("quoting");
    const storage = within(other).getByTestId("velero-storage-location-storage");

    expect(fact(storage, "Validation frequency")).toEqual({
      value: "Not read: soon",
      note: "This is not a frequency the release takes: it uses the one of its server, which this view does not read.",
    });
    // A period below zero is not one the release takes: it is not shown as one it syncs by.
    expect(fact(storage, "Sync period")).toEqual({
      value: "Not read: -1m",
      note: "This is not a period the release takes: it uses the one of its server, which this view does not read.",
    });
    expect(fact(within(other).getByTestId("velero-storage-location-status"), "Last validation")).toEqual({
      value: `${shown("2026-09-10T11:59:50Z")} (10s ago)`,
      note: undefined,
    });
  });

  it("shows an address that the message of Velero quotes without what it may hide, and says so", async () => {
    mount(answers({ [path("storageLocations", A)]: list(main, quoting) }), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(row("quoting").querySelector("[data-availability]")?.getAttribute("title")).toBe(
      'Get "https://s3.example.test/store": no such host',
    );
    const workspace = await open("quoting");

    expect(fact(within(workspace).getByTestId("velero-storage-location-status"), "Availability")).toEqual({
      value: "highlight_offUnavailable",
      note: `Get "https://s3.example.test/store": no such host ${LEFT_OUT}`,
    });
    expect(document.body.textContent).not.toMatch(/secret@|reader:|token=abc/);
    const props = listProps.get("veleroStorageLocationsTable") ?? {};
    const items = (props.getItems as () => { getName(): string }[])();
    const searched = (props.searchFilters as ((item: unknown) => string[])[]).flatMap((filter) =>
      filter(items.find((item) => item.getName() === "quoting")),
    );

    expect(searched.join(" ")).not.toMatch(/secret@|reader:|token=abc/);
  });

  it("shows a name, a bucket and a prefix as long as they can be, whole", async () => {
    mount(answers({ [path("storageLocations", A)]: list(main, long) }), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(2));
    // The name of the row is whole in its tip, where the list cuts it.
    expect(screen.getByText(LONG, { selector: "[data-storage-location-row]" }).getAttribute("title")).toBe(LONG);
    const workspace = await open(LONG);
    const storage = within(workspace).getByTestId("velero-storage-location-storage");

    expect(within(workspace).getByTestId("velero-storage-location-name").textContent).toBe(LONG);
    expect(fact(storage, "Bucket").value).toBe(LONG_BUCKET);
    expect(fact(storage, "Prefix").value).toBe(LONG_PREFIX);
    expect([LONG.length, LONG_BUCKET.length]).toEqual([63, 63]);
  });

  it("keeps the location that was read when the next read fails, and says when it was read", async () => {
    const { installation, table, clock } = mount(answers(), chosen(A));
    const workspace = await open("archive");

    expect(within(workspace).queryByTestId("velero-storage-location-stale")).toBeNull();
    const read = new Date(clock.now).toLocaleTimeString();

    clock.now += 60_000;
    table[path("storageLocations", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(within(workspace).getByTestId("velero-storage-location-stale").textContent).toBe(
      `The backup storage locations could not be read again: this is what was read at ${read}.`,
    );
    expect(fact(within(workspace).getByTestId("velero-storage-location-status"), "Access mode").value).toBe(
      "Read only",
    );
    expect(notice("storageLocations")).toContain("could not be read");
    table[path("storageLocations", A)] = list(main, archive, broken, silent, odd);
    await act(() => installation.refresh());
    expect(within(workspace).queryByTestId("velero-storage-location-stale")).toBeNull();
  });

  it("says not reported of a location without a status, with no mark of health", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("silent");
    const status = within(workspace).getByTestId("velero-storage-location-status");

    expect(fact(status, "Availability").value).toBe("help_outlineNot reported");
    expect(status.querySelector("[data-availability]")?.getAttribute("data-mark")).toBe("unknown");
    expect(fact(status, "Last validation")).toEqual({ value: "Never validated", note: undefined });
    expect(fact(status, "Access mode")).toEqual({
      value: "Not set",
      note: "The release refuses a backup for the access mode only when it is read-only.",
    });
    expect(within(workspace).getByTestId("velero-location-refused").textContent).toBe(REFUSED_WHEN_NOT_AVAILABLE);
    expect(workspace.textContent).not.toMatch(/healthy|\bok\b|check_circle/i);
  });

  it("shows where the location points as the object carries it, and a URL without what it may hide", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("default");
    const storage = within(workspace).getByTestId("velero-storage-location-storage");
    const config = within(workspace).getByTestId("velero-location-config");
    const entry = (key: string) => config.querySelector(`[data-config-key="${key}"] td`)?.textContent;

    expect(fact(storage, "Provider").value).toBe("aws");
    expect(fact(storage, "Bucket").value).toBe("backups");
    expect(fact(storage, "Prefix").value).toBe("prod");
    expect(fact(storage, "Validation frequency")).toEqual({ value: "Every 1m0s", note: undefined });
    expect(fact(storage, "Sync period").value).toBe("Every 1m0s");
    expect(
      [...config.querySelectorAll("[data-config-key]")].map((item) => item.getAttribute("data-config-key")),
    ).toEqual(["insecureSkipTLSVerify", "region", "s3Url"]);
    expect(entry("region")).toBe("us-east-1");
    expect(entry("s3Url")).toBe("https://s3.example.test:9000/store");
    expect(within(workspace).getByTestId("velero-location-left-out").textContent).toBe(LEFT_OUT);
    expect(workspace.textContent).not.toMatch(/secret@|reader:|token=abc/);
    // For the provider whose key the project read, the verification that is turned off is said in words.
    expect(entry("insecureSkipTLSVerify")).toBe("truewarning_amber The verification of TLS is turned off");
  });

  it("says what the key of the verification does with another backend, and when there is no configuration", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("broken");

    // With a backend that is not the one of AWS the release reads the key for what it moves with restic.
    expect(
      within(workspace)
        .getByTestId("velero-location-config")
        .querySelector('[data-config-key="insecureSkipTLSVerify"] td')?.textContent,
    ).toBe(
      "truewarning_amber The verification of TLS is turned off for the file system backups the release makes with restic",
    );
    expect(within(workspace).queryByTestId("velero-location-left-out")).toBeNull();
    fireEvent.click(screen.getByTestId("velero-back"));
    const none = await open("silent");

    expect(within(none).getByTestId("velero-location-config").getAttribute("data-config")).toBe("none");
    expect(within(none).getByTestId("velero-location-config").textContent).toBe(
      "The location carries no configuration.",
    );
  });

  it("shows a credential and a certificate by the names of their Secret, and reads no Secret", async () => {
    const { asked } = mount(answers(), chosen(A));
    const workspace = await open("default");
    const credentials = within(workspace).getByTestId("velero-storage-location-credentials");

    expect(fact(credentials, "Credential")).toEqual({
      value: "Secret cloud-credentials, key cloud",
      note: "The Secret is named, and is not read.",
    });
    expect(fact(credentials, "Certificate").value).toBe("Secret storage-ca, key ca.crt");
    expect(within(workspace).queryByTestId("velero-location-inline-certificate")).toBeNull();
    // Every path the views asked is of the kinds of Velero: none is of a Secret.
    expect(asked.length).toBeGreaterThan(0);
    for (const address of asked) {
      expect(address.startsWith("/apis/velero.io/")).toBe(true);
      expect(address).not.toMatch(/secret/i);
    }
  });

  it("says that a certificate is written in the location, with its size, and shows nothing of it", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("broken");
    const credentials = within(workspace).getByTestId("velero-storage-location-credentials");

    expect(fact(credentials, "Certificate in the object")).toEqual({
      value: "Present, 4 bytes",
      note: "A certificate written in the location is deprecated in the reviewed release. Its content is not shown.",
    });
    expect(workspace.textContent).not.toContain("QUJDRA");
    expect(fact(credentials, "Credential")).toEqual({ value: "Not set", note: undefined });
    expect(fact(credentials, "Certificate").value).toBe("Not set");
  });

  it("shows the backups and the schedules that name the location, and leads to them and back", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("default");
    const users = within(workspace).getByTestId("velero-location-users");

    expect(within(users).getByTestId("velero-location-backups-counts").textContent).toBe(
      "3 backups that exist: 1 completed; 1 ended with a failure; 1 in flight.",
    );
    expect(within(within(users).getByTestId("velero-location-newest")).getByRole("button").textContent).toBe("b-3");
    expect(
      within(within(users).getByTestId("velero-location-schedules"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["hourly", "nightly"]);
    // The backups of another installation that name a location of the same name are not of this one.
    expect(users.textContent).not.toContain("elsewhere");
    fireEvent.click(within(users).getByText("b-3"));
    await screen.findByTestId("velero-backup-workspace");
    expect(screen.getByTestId("velero-storage-locations-page")).toBeTruthy();
    expect(screen.getByTestId("velero-back").textContent).toContain("Backup Storage Locations / default");
    // The backup names its location, which is where it was opened from: the way back, not a way further.
    fireEvent.click(within(screen.getByTestId("velero-reference-BackupStorageLocation-default")).getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("velero-storage-location-name").textContent).toBe("default"));
    expect(openViews()).toEqual([{ kind: "storage-location", name: "default" }]);
    fireEvent.click(within(screen.getByTestId("velero-location-schedules")).getByText("nightly"));
    await screen.findByTestId("velero-schedule-workspace");
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.getByTestId("velero-storage-location-name").textContent).toBe("default"));
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.queryByTestId("velero-storage-location-workspace")).toBeNull());
    expect(document.activeElement?.getAttribute("data-storage-location-row")).toBe("default");
  });

  it("says which schedules name no location, beside the location marked default their backups go to", async () => {
    const unnamed = object(
      "Schedule",
      "unnamed",
      A,
      { schedule: "0 5 * * *", skipImmediately: false, template: { includedNamespaces: ["shop"] } },
      { phase: "Enabled" },
    );

    mount(answers({ [path("schedules", A)]: list(...schedules, unnamed) }), chosen(A));
    const workspace = await open("default");
    const sent = within(workspace).getByTestId("velero-location-by-default");

    expect(
      within(sent)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["unnamed"]);
    expect(within(workspace).getByTestId("velero-location-by-default-note").textContent).toBe(
      "Their template names no location: their backups go to the one marked default, which is this one.",
    );
    // The ones that name it are apart, and the one that names none is not among them.
    expect(
      within(within(workspace).getByTestId("velero-location-schedules"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["hourly", "nightly"]);
    // A location that is not marked default has no such line.
    fireEvent.click(screen.getByTestId("velero-back"));
    const other = await open("archive");

    expect(within(other).queryByTestId("velero-location-by-default")).toBeNull();
  });

  it("does not say which of the locations marked default takes the backups of a schedule that names none", async () => {
    const second = object(
      "BackupStorageLocation",
      "second",
      A,
      { default: true },
      { phase: "Available" },
      { created: "2026-08-20T00:00:00Z" },
    );
    const unnamed = object("Schedule", "unnamed", A, { schedule: "0 5 * * *", template: {} }, { phase: "Enabled" });

    mount(
      answers({
        [path("storageLocations", A)]: list(main, second),
        [path("schedules", A)]: list(unnamed),
      }),
      chosen(A),
    );
    for (const name of ["default", "second"]) {
      const workspace = await open(name);

      expect(within(workspace).getByTestId("velero-location-by-default").textContent).toContain("unnamed");
      expect(within(workspace).getByTestId("velero-location-by-default-note").textContent).toBe(
        "Their template names no location, and more than one is marked default: their backups go to the first of them the release finds.",
      );
      expect(within(workspace).getByTestId("velero-location-schedules").textContent).toBe(
        "No schedule names this location in its template",
      );
      fireEvent.click(screen.getByTestId("velero-back"));
      await waitFor(() => expect(screen.queryByTestId("velero-storage-location-workspace")).toBeNull());
    }
  });

  it("says that every schedule names a location, and that the ones that name none are not known when not read", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("default");

    expect(within(workspace).getByTestId("velero-location-by-default").textContent).toBe(
      "Every schedule names a location in its template",
    );
    expect(within(workspace).queryByTestId("velero-location-by-default-note")).toBeNull();
    cleanup();
    act(() => closeViews());
    mount(answers({ [path("schedules", A)]: { status: 403 } }), chosen(A));
    const denied = await open("default");

    expect(within(denied).getByTestId("velero-location-by-default").getAttribute("data-users")).toBe("inaccessible");
    expect(within(denied).getByTestId("velero-location-by-default").textContent).toContain(
      "Which schedules name no location is not known.",
    );
  });

  it("says of the newest backup sent to a location that is unavailable how it ended", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("broken");
    const users = within(workspace).getByTestId("velero-location-users");
    const newest = within(users).getByTestId("velero-location-newest");

    expect(within(users).getByTestId("velero-location-backups-counts").textContent).toBe(
      "2 backups that exist: 1 completed; 1 ended with a failure.",
    );
    // The newest is the one that was refused, at the time it was created: it has no start.
    expect(within(newest).getByRole("button").textContent).toBe("b-refused");
    expect(newest.querySelector("[data-signal]")?.getAttribute("data-signal")).toBe("failure");
    expect(within(users).getByTestId("velero-location-schedules").textContent).toBe(
      "No schedule names this location in its template",
    );
  });

  it("says that no backup and no schedule name a location that none names", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("silent");
    const users = within(workspace).getByTestId("velero-location-users");

    expect(within(users).getByTestId("velero-location-backups").getAttribute("data-users")).toBe("listed");
    expect(within(users).getByTestId("velero-location-backups-counts").textContent).toBe(
      "No backup that exists names this location.",
    );
    expect(within(users).queryByTestId("velero-location-newest")).toBeNull();
    expect(within(users).getByTestId("velero-location-schedules").textContent).toBe(
      "No schedule names this location in its template",
    );
  });

  it("does not say that nothing uses a location when what uses it cannot be read", async () => {
    mount(
      answers({
        [path("backups", A)]: { status: 403 },
        [path("schedules", A)]: { status: 500 },
        [path("restores", A)]: { status: 403 },
        [path("snapshotLocations", A)]: { status: 403 },
      }),
      chosen(A),
    );
    const workspace = await open("default");
    const users = within(workspace).getByTestId("velero-location-users");

    expect(within(users).getByTestId("velero-location-backups").getAttribute("data-users")).toBe("inaccessible");
    expect(within(users).getByTestId("velero-location-backups").textContent).toBe(
      "The backups of this installation cannot be read: access is denied. Which backups name this location is not known, which is not that none does.",
    );
    expect(within(users).getByTestId("velero-location-schedules").getAttribute("data-users")).toBe("unknown");
    expect(within(users).getByTestId("velero-location-schedules").textContent).toContain(
      "Which schedules name this location is not known",
    );
    expect(users.textContent).not.toMatch(/No backup that exists|No schedule names/);
    expect(notice("backups")).toContain("denied");
    expect(notice("schedules")).toContain("could not be read");
    // The view shows nothing of the restores and of the snapshot locations: what is denied of them is
    // not said over it.
    expect(screen.queryByTestId("velero-notice-restores")).toBeNull();
    expect(screen.queryByTestId("velero-notice-snapshotLocations")).toBeNull();
  });

  it("keeps what uses a location when the backups stop answering, and says that it is of an earlier read", async () => {
    const { installation, table, clock } = mount(answers(), chosen(A));
    const workspace = await open("default");

    clock.now += 60_000;
    table[path("backups", A)] = { status: 500 };
    await act(() => installation.refresh());
    const users = within(workspace).getByTestId("velero-location-backups");

    expect(users.getAttribute("data-users")).toBe("listed");
    expect(users.textContent).toContain("3 backups that exist");
    expect(users.textContent).toContain("(read before the backups stopped answering)");
  });

  it("says that a location is not there, or that it is not known, and not the one for the other", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(5));
    act(() => openView({ kind: "storage-location", name: "removed" }));
    expect((await screen.findByTestId("velero-storage-location-missing")).textContent).toContain(
      `No backup storage location of this name is in ${A}`,
    );
    cleanup();
    act(() => closeViews());
    mount(answers({ [path("storageLocations", A)]: { status: 403 } }), chosen(A));
    act(() => openView({ kind: "storage-location", name: "default" }));
    const unknown = await screen.findByTestId("velero-storage-location-unknown");

    expect(unknown.textContent).toContain("Access to the backup storage locations");
    expect(unknown.textContent).toContain("It is not known to be absent");
  });

  it("says in words that a location was created again under the name that is open", async () => {
    const { installation, table } = mount(answers(), chosen(A));
    const workspace = await open("archive");

    expect(within(workspace).queryByTestId("velero-storage-location-replaced")).toBeNull();
    table[path("storageLocations", A)] = list(main, { ...archive, metadata: { ...archive.metadata, uid: "another" } });
    await act(() => installation.refresh());
    expect(screen.getByTestId("velero-storage-location-replaced").textContent).toContain(
      "This is another backup storage location of the same name",
    );
  });

  it("has no control that writes: the way back and the ways to other views", async () => {
    mount(answers(), chosen(A));
    const workspace = await open("default");
    const controls = [...workspace.querySelectorAll("button, a, input, select, textarea")];

    expect(controls.map((control) => control.getAttribute("data-testid"))).toEqual([
      "velero-back",
      "velero-open-backup-b-3",
      "velero-open-schedule-hourly",
      "velero-open-schedule-nightly",
    ]);
    expect(workspace.textContent).not.toMatch(/\b(delete|edit|remove|set as default|validate now)\b/i);
  });
});

describe("list of the volume snapshot locations", () => {
  const mounted = (table = answers()) => mount(table, chosen(A), SnapshotLocationsPage);

  it("gives the host a list that only reads, with the columns of the snapshot locations", async () => {
    mounted();
    await waitFor(() => expect(rows(SNAPSHOT)).toEqual(["snapshots", "claimed"]));
    const props = listProps.get("veleroSnapshotLocationsTable") ?? {};
    const columns = props.renderTableHeader as { id: string; sortBy: string; className: string }[];

    expect(props.isSelectable).toBe(false);
    expect((props.renderItemMenu as () => unknown)()).toBeNull();
    for (const forbidden of ["onAdd", "addRemoveButtons", "renderFooter", "headerActions"]) {
      expect(props[forbidden]).toBeUndefined();
    }
    expect(columns.map((column) => column.id)).toEqual(["name", "namespace", "provider", "availability", "age"]);
    expect(Object.keys(props.sortingCallbacks as object).sort()).toEqual(columns.map((column) => column.sortBy).sort());
    const items = (props.getItems as () => { getName(): string }[])();
    const searched = (props.searchFilters as ((item: unknown) => string[])[]).flatMap((filter) =>
      filter(items.find((item) => item.getName() === "claimed")),
    );

    expect(searched).toEqual(["claimed", A, "csi", "Available", "Available"]);
  });

  it("gives the phase of a snapshot location the mark of what is not known, whatever it says", async () => {
    mounted();
    await waitFor(() => expect(rows(SNAPSHOT)).toHaveLength(2));
    const mark = (name: string) => row(name, SNAPSHOT).querySelector("[data-availability]")?.getAttribute("data-mark");

    expect(cell("claimed", "phase", SNAPSHOT)).toBe("help_outlineAvailable");
    expect(mark("claimed")).toBe("unknown");
    expect(cell("snapshots", "phase", SNAPSHOT)).toBe("help_outlineNot reported");
    expect(mark("snapshots")).toBe("unknown");
    expect(document.body.textContent).not.toContain("check_circle");
    // Why, is said once over the list.
    expect(notes("snapshot-locations")).toEqual([
      "The reviewed release neither writes nor checks the phase of a volume snapshot location: a phase that is here says nothing of whether the location can be used.",
    ]);
  });

  it.each([
    ["denied", { status: 403 }, "Access to the volume snapshot locations of this namespace is denied"],
    ["not answered", {}, "could not be read"],
  ])("does not show a list that was %s as an empty one", async (_name, answer, text) => {
    mounted(answers({ [path("snapshotLocations", A)]: answer as Answer }));
    const state = await screen.findByTestId("velero-snapshot-locations-unavailable");

    expect(state.textContent).toContain(text);
    expect(screen.queryByTestId("velero-snapshot-locations")).toBeNull();
    expect(notes("snapshot-locations")).toEqual([]);
    expect(document.body.textContent).not.toMatch(/\b0 items\b/);
  });

  it("shows a namespace with no snapshot location as a list with none", async () => {
    mounted(answers({ [path("snapshotLocations", A)]: list() }));
    const empty = await screen.findByTestId("velero-snapshot-locations-empty");

    expect(empty.textContent).toContain(`No volume snapshot location is in the namespace ${A}`);
  });

  it("orders the snapshot locations by what each column shows", async () => {
    mounted();
    await waitFor(() => expect(rows(SNAPSHOT)).toHaveLength(2));
    const props = listProps.get("veleroSnapshotLocationsTable") ?? {};
    const items = (props.getItems as () => { getName(): string }[])();
    const order = (column: string) => {
      const by = (props.sortingCallbacks as Record<string, (item: unknown) => string | number>)[column];

      return [...items]
        .sort((one, other) => {
          const [first, second] = [by(one), by(other)];

          return first < second ? -1 : first > second ? 1 : 0;
        })
        .map((item) => item.getName());
    };

    expect(order("name")).toEqual(["claimed", "snapshots"]);
    expect(order("provider")).toEqual(["snapshots", "claimed"]);
    // By the words of the phase: the one that reports a phase before the one that reports none.
    expect(order("availability")).toEqual(["claimed", "snapshots"]);
  });

  it("keeps the snapshot locations that were read when the next read fails, in the list and in the view", async () => {
    const { installation, table, clock } = mounted();

    await waitFor(() => expect(rows(SNAPSHOT)).toHaveLength(2));
    const read = new Date(clock.now).toLocaleTimeString();

    clock.now += 60_000;
    table[path("snapshotLocations", A)] = { status: 500 };
    await act(() => installation.refresh());
    expect(rows(SNAPSHOT)).toHaveLength(2);
    expect(notice("snapshotLocations")).toContain(`What is shown was read at ${read}`);
    const workspace = await open("claimed", SNAPSHOT);

    expect(within(workspace).getByTestId("velero-snapshot-location-stale").textContent).toBe(
      `The volume snapshot locations could not be read again: this is what was read at ${read}.`,
    );
    table[path("snapshotLocations", A)] = list(snapshots, claimed);
    await act(() => installation.refresh());
    expect(within(workspace).queryByTestId("velero-snapshot-location-stale")).toBeNull();
    expect(notice("snapshotLocations")).toBe("");
  });

  it("shows the phase as it is written in the workspace, and says that the release does not stand behind it", async () => {
    mounted();
    const workspace = await open("claimed", SNAPSHOT);
    const status = within(workspace).getByTestId("velero-snapshot-location-status");

    expect(fact(status, "Phase")).toEqual({ value: "help_outlineAvailable", note: SNAPSHOT_PHASE_NOTE });
    expect(fact(status, "Provider").value).toBe("csi");
    expect(within(workspace).getByTestId("velero-location-config").getAttribute("data-config")).toBe("none");
    expect(fact(within(workspace).getByTestId("velero-snapshot-location-credentials"), "Credential").value).toBe(
      "Not set",
    );
    expect(within(workspace).queryByTestId("velero-location-refused")).toBeNull();
    expect(screen.getByTestId("velero-back").textContent).toContain("Volume Snapshot Locations");
  });

  it("shows the configuration, the credential and what uses a snapshot location", async () => {
    mounted();
    const workspace = await open("snapshots", SNAPSHOT);
    const config = within(workspace).getByTestId("velero-location-config");
    const users = within(workspace).getByTestId("velero-location-users");

    expect(fact(within(workspace).getByTestId("velero-snapshot-location-status"), "Phase").value).toBe(
      "help_outlineNot reported",
    );
    // The key that is marked is one of the storage: it is shown here as it is written.
    expect(config.querySelector('[data-config-key="insecureSkipTLSVerify"] td')?.textContent).toBe("true");
    expect(within(workspace).queryByTestId("velero-location-unverified")).toBeNull();
    expect(fact(within(workspace).getByTestId("velero-snapshot-location-credentials"), "Credential").value).toBe(
      "Secret snapshot-credentials, key cloud",
    );
    expect(within(users).getByTestId("velero-location-backups-counts").textContent).toBe(
      "2 backups that exist: 1 completed; 1 in flight.",
    );
    expect(
      within(within(users).getByTestId("velero-location-schedules"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["nightly"]);
    const controls = [...workspace.querySelectorAll("button, a, input, select, textarea")];

    expect(controls.map((control) => control.getAttribute("data-testid"))).toEqual([
      "velero-back",
      "velero-open-backup-b-3",
      "velero-open-schedule-nightly",
    ]);
  });
});

describe("way from the other views to a location", () => {
  it("leads from a schedule to the location of its template and to its snapshot location, and back", async () => {
    mount(answers(), chosen(A), SchedulesPage);
    await waitFor(() => expect(rows("schedule")).toContain("nightly"));
    fireEvent.click(screen.getByText("nightly", { selector: "[data-schedule-row]" }));
    await screen.findByTestId("velero-schedule-workspace");
    fireEvent.click(within(screen.getByTestId("velero-reference-BackupStorageLocation-default")).getByRole("button"));
    await screen.findByTestId("velero-storage-location-workspace");
    expect(screen.getByTestId("velero-schedules-page")).toBeTruthy();
    expect(screen.getByTestId("velero-back").textContent).toContain("Schedules / nightly");
    fireEvent.click(screen.getByTestId("velero-back"));
    await screen.findByTestId("velero-schedule-workspace");
    fireEvent.click(
      within(screen.getByTestId("velero-reference-VolumeSnapshotLocation-snapshots")).getByRole("button"),
    );
    const workspace = await screen.findByTestId("velero-snapshot-location-workspace");

    expect(within(workspace).getByTestId("velero-snapshot-location-name").textContent).toBe("snapshots");
    expect(screen.getByTestId("velero-back").textContent).toContain("Schedules / nightly");
    fireEvent.click(screen.getByTestId("velero-back"));
    await waitFor(() => expect(screen.getByTestId("velero-schedule-name").textContent).toBe("nightly"));
  });

  it("leads from a backup to its locations, and gives no way to one that is not there", async () => {
    mount(
      answers({
        [path("backups", A)]: list(
          backups[0],
          object("Backup", "b-lost", A, to("removed", ["removed"]), ran("2026-09-09")),
        ),
      }),
      chosen(A),
      BackupsPage,
    );
    await waitFor(() => expect(rows("backup")).toContain("b-1"));
    fireEvent.click(screen.getByText("b-1", { selector: "[data-backup-row]" }));
    await screen.findByTestId("velero-backup-workspace");
    fireEvent.click(
      within(screen.getByTestId("velero-reference-VolumeSnapshotLocation-snapshots")).getByRole("button"),
    );
    await screen.findByTestId("velero-snapshot-location-workspace");
    expect(screen.getByTestId("velero-backups-page")).toBeTruthy();
    expect(screen.getByTestId("velero-back").textContent).toContain("Backups / b-1");
    act(() => closeViews());
    await waitFor(() => expect(screen.queryByTestId("velero-snapshot-location-workspace")).toBeNull());
    fireEvent.click(screen.getByText("b-lost", { selector: "[data-backup-row]" }));
    await screen.findByTestId("velero-backup-workspace");
    const lost = screen.getByTestId("velero-reference-BackupStorageLocation-removed");

    expect(lost.getAttribute("data-reference")).toBe("absent");
    expect(within(lost).queryByRole("button")).toBeNull();
    expect(
      within(screen.getByTestId("velero-reference-VolumeSnapshotLocation-removed")).queryByRole("button"),
    ).toBeNull();
  });
});

describe("details of the host for a location", () => {
  const extension = { name: "@freelensapp/velero-extension" } as unknown as Renderer.LensExtension;
  const installation = (preferences: Preferences) =>
    new Installation({
      cluster: { id: "cluster-a", name: "local-demo" },
      read: async () => ({ status: 404 }),
      now: () => NOW,
      storage: { read: () => preferences, write: () => undefined },
    });
  const item = (name: string) => document.querySelector(`[data-name="${name}"] .value`)?.textContent;

  it("reads a storage location as the views do, and leads to the workspace of the installation selected", async () => {
    mount(answers(), chosen(A));
    await waitFor(() => expect(rows()).toHaveLength(5));
    const listed = {
      access: cell("archive", "access"),
      marked: cell("archive", "marked"),
      synced: cell("archive", "synced"),
    };

    cleanup();
    render(
      <StorageLocationDetails
        object={new BackupStorageLocation(archive as never)}
        extension={extension}
        installation={installation(chosen(A))}
      />,
    );
    expect(item("Availability")).toBe("check_circle_outlineAvailable");
    expect(item("Access mode")).toBe(listed.access);
    expect(item("Default")).toBe(listed.marked);
    expect(item("Last sync")).toBe(listed.synced);
    expect(item("Last validation")).toBe(`${shown("2026-09-08T12:00:00Z")} (2d ago)`);
    expect(item("Validation frequency")).toBe("Not set");
    expect(item("Notes")).toBe(
      "The availability may be out of date: the last validation is older than one hour, by the clock of this machine. The location is available and read-only: it does not take new backups.",
    );
    expect(screen.getByTestId("velero-storage-location-details-link").getAttribute("href")).toBe(
      "/extension/freelensapp--velero-extension/storage-locations?view=storage-location%2Farchive",
    );
  });

  it("shows the message of Velero, and gives no link to a location of a namespace that is not selected", () => {
    render(
      <StorageLocationDetails
        object={new BackupStorageLocation(broken as never)}
        extension={extension}
        installation={installation(chosen(B))}
      />,
    );
    expect(item("Availability")).toBe("highlight_offUnavailable");
    expect(document.querySelector("[data-availability]")?.getAttribute("data-mark")).toBe("unavailable");
    expect(item("Message")).toBe("the bucket does not exist\nand the second line says where it was looked for");
    expect(screen.queryByTestId("velero-storage-location-details-link")).toBeNull();
    expect(screen.getByTestId("velero-storage-location-details-elsewhere").textContent).toContain(A);
  });

  it("reads a snapshot location as the views do, and says what its phase is worth", () => {
    render(
      <SnapshotLocationDetails
        object={new VolumeSnapshotLocation(claimed as never)}
        extension={extension}
        installation={installation(chosen(A))}
      />,
    );
    // The mark of what is not known, in the details as in the list.
    expect(item("Phase")).toBe("help_outlineAvailable");
    expect(document.querySelector("[data-availability]")?.getAttribute("data-mark")).toBe("unknown");
    expect(item("Provider")).toBe("csi");
    expect(item("Credential")).toBe("Not set");
    expect(item("Notes")).toBe(SNAPSHOT_PHASE_NOTE);
    expect(screen.getByTestId("velero-snapshot-location-details-link").getAttribute("href")).toBe(
      "/extension/freelensapp--velero-extension/snapshot-locations?view=snapshot-location%2Fclaimed",
    );
  });
});
