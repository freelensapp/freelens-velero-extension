/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// What the sessions of the integration test share: one session for each of the ten kinds the extension
// shows, as the integration test of the template has one for each version of its kind. Five are the kinds of
// the first milestones, Backup, Restore, Schedule, BackupStorageLocation and VolumeSnapshotLocation; three are
// the kinds of SPEC-0014 under `velero.io/v1`, BackupRepository, PodVolumeBackup and PodVolumeRestore, whose
// sessions the amendment of SPEC-0015 of 2026-10-27 left to the last pull request of T5.1; two are the kinds of
// the data movement under `velero.io/v2alpha1`, DataUpload and DataDownload, whose sessions came with their
// fixtures in the second pull request of T5.2. A session puts one
// object of its kind in a namespace of its own on the cluster of the test environment, and removes the
// namespace with the object when it ends. The namespace is not the one of a server of Velero, so no
// controller reads the object: the cache of the server holds its own namespace only, and the node agent
// selects the pod volume operations of its namespace by a field (v1.18.4, pkg/cmd/server/server.go:272-276,
// pkg/cmd/cli/nodeagent/server.go:183-193). The object stays as it was written. The session needs neither
// the fixtures of the views nor another file having run, and it writes nothing but its namespace and its
// object.
//
// Every kubectl names the kubeconfig and the context of the environment: the runner of the integration test,
// `pnpm e2e:integration`, checks the target of the environment before and after, and gives both.

import { spawnSync } from "node:child_process";
import * as cluster from "./velero-cluster";

import type { Frame, Locator } from "playwright";

/**
 * The label of what a session writes, its namespace and its object, by which the runner finds anything a
 * session left. The runner, `e2e/scripts/local-demo.mts`, names the same label.
 */
export const SESSION_LABEL = "freelensapp.io/velero-integration-session";

const ELEMENT_TIMEOUT = 60 * 1000;
const KUBECTL_TIMEOUT = 5 * 60 * 1000;

/** One of the eight sessions: the kind, how the extension and the host show it, and the object of the session. */
export interface KindSession {
  /** The kind, as the API names it. */
  kind:
    | "Backup"
    | "Restore"
    | "Schedule"
    | "BackupStorageLocation"
    | "VolumeSnapshotLocation"
    | "BackupRepository"
    | "PodVolumeBackup"
    | "PodVolumeRestore"
    | "DataUpload"
    | "DataDownload";
  /** Its plural, by which the API and the list of the host name it. */
  resource: string;
  /** The list of the extension that shows it. */
  list: cluster.ListOf;
  /** The namespace of the session, which holds its object and nothing else. */
  namespace: string;
  /** The name of the object. */
  name: string;
  /** What the object asks for: a synthetic spec the CRD of the reviewed release accepts. */
  spec: Record<string, unknown>;
}

function session(kind: KindSession["kind"], resource: string, list: cluster.ListOf, spec: KindSession["spec"]) {
  return { kind, resource, list, namespace: `velero-integration-${list.id}`, name: `integration-${list.kind}`, spec };
}

/**
 * The pod of the pod volume operations of the sessions: a reference of the shape the release writes, to a pod no
 * namespace of the cluster holds, as no node agent reads the operations.
 */
const SESSION_POD = {
  kind: "Pod",
  namespace: "integration-source",
  name: "integration-pod",
  uid: "integration-pod-uid",
};

/** The ten sessions, by the list of the extension each one opens. */
export const SESSIONS = {
  backups: session("Backup", "backups", cluster.BACKUPS, {
    includedNamespaces: ["integration-source"],
    storageLocation: "integration-location",
    ttl: "720h0m0s",
  }),
  restores: session("Restore", "restores", cluster.RESTORES, {
    backupName: "integration-backup",
    includedNamespaces: ["integration-source"],
  }),
  schedules: session("Schedule", "schedules", cluster.SCHEDULES, {
    schedule: "0 3 * * *",
    template: { includedNamespaces: ["integration-source"], storageLocation: "integration-location" },
  }),
  storageLocations: session("BackupStorageLocation", "backupstoragelocations", cluster.STORAGE_LOCATIONS, {
    provider: "aws",
    objectStorage: { bucket: "integration-bucket" },
    config: { region: "us-east-1" },
  }),
  snapshotLocations: session("VolumeSnapshotLocation", "volumesnapshotlocations", cluster.SNAPSHOT_LOCATIONS, {
    provider: "aws",
    config: { region: "us-east-1" },
  }),
  repositories: session("BackupRepository", "backuprepositories", cluster.REPOSITORIES, {
    volumeNamespace: "integration-source",
    backupStorageLocation: "integration-location",
    repositoryType: "kopia",
    maintenanceFrequency: "168h0m0s",
  }),
  podVolumeBackups: session("PodVolumeBackup", "podvolumebackups", cluster.POD_VOLUME_BACKUPS, {
    node: "integration-node",
    pod: SESSION_POD,
    volume: "integration-volume",
    tags: {
      backup: "integration-backup",
      pod: SESSION_POD.name,
      ns: SESSION_POD.namespace,
      volume: "integration-volume",
    },
    backupStorageLocation: "integration-location",
    repoIdentifier: "",
    uploaderType: "kopia",
  }),
  podVolumeRestores: session("PodVolumeRestore", "podvolumerestores", cluster.POD_VOLUME_RESTORES, {
    pod: SESSION_POD,
    volume: "integration-volume",
    backupStorageLocation: "integration-location",
    repoIdentifier: "",
    uploaderType: "kopia",
    snapshotID: "integration-snapshot",
    sourceNamespace: SESSION_POD.namespace,
  }),
  // The data movement of a claim of the namespace of the source, which no node agent takes: none reads the namespace
  // of the session.
  dataUploads: session("DataUpload", "datauploads", cluster.DATA_UPLOADS, {
    snapshotType: "CSI",
    csiSnapshot: { volumeSnapshot: "integration-snapshot", storageClass: "integration-storage" },
    sourcePVC: "integration-claim",
    backupStorageLocation: "integration-location",
    sourceNamespace: SESSION_POD.namespace,
    operationTimeout: "10m0s",
  }),
  dataDownloads: session("DataDownload", "datadownloads", cluster.DATA_DOWNLOADS, {
    targetVolume: { pvc: "integration-claim", pv: "", namespace: "integration-restored" },
    backupStorageLocation: "integration-location",
    snapshotID: "integration-snapshot",
    sourceNamespace: SESSION_POD.namespace,
    operationTimeout: "10m0s",
  }),
} satisfies Record<string, KindSession>;

// The version of the group a kind is served under: the data movement under the second.
function versionOf(of: KindSession): string {
  return of.kind === "DataUpload" || of.kind === "DataDownload" ? "velero.io/v2alpha1" : "velero.io/v1";
}

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Run the integration test through \`pnpm e2e:integration\`.`);
  }

  return value;
}

/**
 * Runs the pinned kubectl of the test environment against its cluster, with its kubeconfig and its context,
 * and fails with what kubectl wrote when it does not succeed. It is not exported: the sessions write only
 * what the functions below write.
 */
function kubectl(args: string[], input?: string): string {
  const command = `kubectl ${args.join(" ")}`;
  const { error, status, signal, stdout, stderr } = spawnSync(
    required("E2E_KUBECTL"),
    ["--kubeconfig", required("E2E_KUBECONFIG"), "--context", cluster.E2E_KUBE_CONTEXT, ...args],
    { input, encoding: "utf8", timeout: KUBECTL_TIMEOUT },
  );

  console.log(command);
  if (error) throw new Error(`${command} failed: ${error.message}`);
  if (status !== 0) throw new Error(`${command} exited with ${status ?? signal}: ${stderr.trim()}`);

  return stdout;
}

/** Removes the namespace of the session with its object, and waits until it is gone. */
export function removeObject(of: KindSession): void {
  kubectl(["delete", "namespace", of.namespace, "--ignore-not-found", "--wait", "--timeout=180s"]);
}

/**
 * Puts the object of the session in its namespace, once what an earlier run of it left is removed: the
 * namespace, then the object, both with the label of the sessions.
 */
export function placeObject(of: KindSession): void {
  const labels = { [SESSION_LABEL]: of.list.id };

  removeObject(of);
  kubectl(
    ["create", "-f", "-"],
    JSON.stringify({
      apiVersion: "v1",
      kind: "List",
      items: [
        { apiVersion: "v1", kind: "Namespace", metadata: { name: of.namespace, labels } },
        {
          apiVersion: versionOf(of),
          kind: of.kind,
          metadata: { name: of.name, namespace: of.namespace, labels },
          spec: of.spec,
        },
      ],
    }),
  );
}

/** What the cluster still holds of the session: its namespace, by name, or nothing. */
export function leftOf(of: KindSession): string[] {
  return kubectl(["get", "namespaces", "--selector", `${SESSION_LABEL}=${of.list.id}`, "-o", "name"])
    .split("\n")
    .filter(Boolean);
}

/** The row of the object in the list of the extension. */
function extensionRow(frame: Frame, of: KindSession): Locator {
  return frame.locator(`[data-testid=velero-${of.list.id}] .TableRow`, {
    has: frame.locator(`[data-${of.list.kind}-row="${of.name}"]`),
  });
}

/**
 * Opens the page of the kind from the sidebar and, unless it shows it already, names the namespace of the
 * session as the installation to read, as an operator names one no discovery suggests. Answers the row of
 * the object in the list of the page.
 */
export async function openList(frame: Frame, of: KindSession): Promise<Locator> {
  await cluster.openPage(frame, of.list);

  const shown = frame.locator("[data-testid=velero-target] .Select__single-value");
  const row = extensionRow(frame, of);

  // What the page shows first: the list of an installation, the choice among the ones it found, or the form.
  await frame
    .locator("[data-testid=velero-target], [data-testid=velero-state-choose], [data-testid=velero-state-configure]")
    .first()
    .waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  if (!(await shown.count()) || !(await shown.innerText()).startsWith(of.namespace)) {
    await cluster.configureInstallation(frame, of.namespace);
  }
  await row.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

  return row;
}

/** The address of the object, as the host names it in the address of its details and in its menu. */
function selfLink(of: KindSession): string {
  return `/apis/${versionOf(of)}/namespaces/${of.namespace}/${of.resource}/${of.name}`;
}

/**
 * Opens the list the host has of the kind, by its address, the one way to it while the extension is enabled:
 * the Custom Resources tree leaves the kind out. Its namespace filter is pointed at the namespace of the
 * session, and the row of the object is answered.
 */
async function openHostList(frame: Frame, of: KindSession): Promise<Locator> {
  await cluster.navigate(frame, `/crd/velero.io/${of.resource}`);

  const filtered = frame.locator(`[data-testid="namespace-select-filter"] >> text="Namespace: ${of.namespace}"`);

  await frame.waitForSelector(".NamespaceSelect", { timeout: ELEMENT_TIMEOUT });
  if (!(await filtered.count())) await cluster.selectHostNamespace(frame, of.namespace);

  const row = frame.locator(".TableRow", { has: frame.locator(".TableCell", { hasText: of.name }) }).first();

  await row.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

  return row;
}

/** What the details of the host show of the object in the section of the extension. */
export interface DetailsShown {
  /** The value of the item "Installation" of the section. */
  installation: string | null;
  /** How many ways the section has to the view of the object in the extension. */
  links: number;
  /** How many error pages of the extension the drawer shows. */
  errorPages: number;
}

/**
 * Opens the details of the object from the list of the host, as an operator does with a click on its row,
 * reads the section of the extension in the drawer, and closes the drawer again.
 */
export async function openDetails(frame: Frame, of: KindSession): Promise<DetailsShown> {
  const row = await openHostList(frame, of);

  await row.locator(".TableCell", { hasText: of.name }).first().click();

  const drawer = frame.locator(".Drawer.KubeObjectDetails");
  const section = drawer.locator(`[data-testid=velero-${of.list.kind}-details]`);
  const installation = section
    .locator(".DrawerItem")
    .filter({ has: frame.locator(".name").getByText("Installation", { exact: true }) })
    .locator(".value");

  await installation.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

  const shown: DetailsShown = {
    installation: await installation.textContent(),
    links: await section.locator(`[data-testid=velero-${of.list.kind}-details-link]`).count(),
    errorPages: await drawer.locator("[data-testid=velero-error-page]").count(),
  };

  await cluster.closeDetails(frame);

  return shown;
}

/** An item of the menu of an object: its title, and whether it is a command of the host for that object. */
export interface MenuItemShown {
  title: string;
  ofTheHost: boolean;
}

/**
 * Opens the menu of the object from its row in the list of the host, reads its items, and closes it with
 * Escape. An item of the host is one of the commands it makes for the object, which it names by their title
 * and by the address of the object; an item an extension registers is drawn by the extension, without it.
 */
export async function openMenu(frame: Frame, of: KindSession): Promise<MenuItemShown[]> {
  const row = await openHostList(frame, of);
  const trigger = row.locator('.TableCell.menu [data-testid^="icon-for-menu-actions-for-kube-object-menu-for-"]');
  const triggerTestId = await trigger.getAttribute("data-testid", { timeout: ELEMENT_TIMEOUT });

  if (!triggerTestId) {
    throw new Error(`The row of ${of.name} has no menu`);
  }
  await trigger.click();

  const menu = frame.getByTestId(triggerTestId.replace(/^icon-for-/, ""));

  await menu.locator(".MenuItem").first().waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

  const items = await menu.locator(".MenuItem").evaluateAll(
    (elements, link) =>
      elements.map((element) => {
        const title = (element.querySelector(".title")?.textContent ?? element.textContent ?? "").trim();

        return {
          title,
          ofTheHost:
            element.getAttribute("data-testid") ===
            `menu-action-${title.toLowerCase().replace(/\s+/, "-")}-for-${link}`,
        };
      }),
    selfLink(of),
  );

  await frame.locator("body").press("Escape");
  await menu.waitFor({ state: "hidden", timeout: ELEMENT_TIMEOUT });

  return items;
}
