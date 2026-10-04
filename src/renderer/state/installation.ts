import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { withAllowance, withoutAllowance } from "../../common/allowances";
import {
  apiAvailability,
  choices,
  current,
  entry,
  FAMILIES,
  familyStatus,
  selection,
  suggestions,
  validNamespace,
} from "../../common/discovery";
import { PATHS } from "../../common/paths";
import { emptyRead, failed, failedStatus, loading, succeeded } from "../../common/read-state";
import { readWindow } from "../../common/window";
import { ServerStatus } from "./server-status";

import type { Allowance, AllowanceFor } from "../../common/allowances";
import type {
  Answer,
  ApiAvailability,
  Choice,
  Entry,
  Family,
  Generation,
  PreferenceStorage,
  Preferences,
  Selection,
  Suggestions,
} from "../../common/discovery";
import type { GateState } from "../../common/ipc";
import type { FamilyRead } from "../../common/read-state";
import type {
  BackupResource,
  BackupStorageLocationResource,
  RestoreResource,
  ScheduleResource,
  VeleroResource,
  VolumeSnapshotLocationResource,
} from "../../common/types";
import type { Window } from "../../common/window";
import type { AllowanceClient, GateClient, WriteClient } from "../api/ipc";

// What asks the cluster: one verb, and the status of the answer beside its body.
export type Reader = (path: string, signal?: AbortSignal) => Promise<Answer>;

export type Resource = VeleroResource<unknown, unknown>;
export type Reads = Record<Family, FamilyRead<Resource>>;

// What the objects of each family are read as.
export interface FamilyItems {
  backups: BackupResource;
  restores: RestoreResource;
  schedules: ScheduleResource;
  storageLocations: BackupStorageLocationResource;
  snapshotLocations: VolumeSnapshotLocationResource;
}

export interface ClusterIdentity {
  id: string;
  name: string;
}

export interface InstallationDependencies {
  cluster: ClusterIdentity;
  read: Reader;
  now: () => number;
  storage: PreferenceStorage;
  // The gate of the main process, when the views have a way to it. Without it writes are off, and the
  // views say that they cannot be turned on.
  gate?: GateClient;
  // The writes of the main process, through the same way as the gate.
  writer?: WriteClient;
  // What keeps, in the main process, what the operator allowed the downloads to do.
  allowances?: AllowanceClient;
  // The identifier of a new request of a write. A random UUID when none is given.
  requestId?: () => string;
}

// What the views show of the gate: what the main process last said of it, and why it could not be asked.
export type Writes = GateState["writes"];

function emptyReads(): Reads {
  return Object.fromEntries(FAMILIES.map((family) => [family, emptyRead<Resource>()])) as Reads;
}

// What the views of one cluster know of Velero: what the API serves, where the installations may be, which
// one was chosen and what was read of it. Nothing is asked before a view is opened.
export class Installation {
  api: ApiAvailability = { state: "unknown" };
  found: Suggestions = { state: "unknown" };
  preferences: Preferences;
  // The choice of this session, which is not kept: the only installation there is, taken without asking.
  generation: Generation;
  reads: Reads = emptyReads();
  // When the families of the selected namespace were last asked, whatever they answered.
  asked?: number;
  // The reads that were asked and did not end: what the cluster serves, where the installations are, and
  // the families.
  asking = 0;
  // What the main process last said of the gate of this cluster: a mirror, and never a decision.
  gate?: GateState;
  // Why the gate could not be asked, in words, when it could not.
  gateFailure?: string;
  // Why an allowance could not be given or taken back, in words, when it could not.
  allowanceFailure?: string;
  // The version of the server and its plugins, when the operator asked for them.
  readonly server: ServerStatus;
  private readonly dependencies: InstallationDependencies;
  private watchers = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(dependencies: InstallationDependencies) {
    this.dependencies = dependencies;
    this.preferences = dependencies.storage.read();
    this.generation = { cluster: dependencies.cluster.id, namespace: "", number: 0 };
    this.server = new ServerStatus({
      client: dependencies.writer,
      cluster: () => this.cluster.id,
      namespace: () => this.namespace,
      writesOn: () => this.writes.on,
      now: dependencies.now,
      requestId: dependencies.requestId ?? (() => crypto.randomUUID()),
      refused: () => void this.openGate(),
    });
    makeObservable(this, {
      api: observable.ref,
      found: observable.ref,
      preferences: observable.ref,
      generation: observable.ref,
      reads: observable.ref,
      asked: observable,
      asking: observable,
      gate: observable.ref,
      gateFailure: observable,
      allowanceFailure: observable,
      choices: computed,
      selection: computed,
      entry: computed,
      namespace: computed,
      reading: computed,
      window: computed,
      writes: computed,
      gateUnknown: computed,
      select: action,
      chooseWindow: action,
      configure: action,
      forget: action,
    });
  }

  // Whether writes are on for the installation that is shown, as the main process last said.
  get writes(): Writes {
    const gate = this.gate;

    if (!gate?.writes.on || gate.writes.namespace !== this.namespace) return { on: false };
    return gate.writes;
  }

  // The main process was asked and its answer is not known: it failed, or was lost on the way, and the
  // main process may have done what it was asked or not. The views show neither on nor off, and offer to
  // ask again. Without a way to the main process there is nothing to ask: writes are off.
  get gateUnknown(): boolean {
    return Boolean(this.dependencies.gate) && !this.gate && this.gateFailure !== undefined;
  }

  // Asks the main process what the gate of this cluster is. The first view asks it once; the target bar
  // asks it again when the main process says that it changed.
  async openGate(): Promise<void> {
    const client = this.dependencies.gate;

    if (!client) {
      runInAction(() => {
        this.gateFailure = "The views have no way to the main process of the extension: writes cannot be turned on.";
      });
      return;
    }
    this.takeGate(await client.state(this.cluster.id));
  }

  // Turns writes on for the namespace that is shown, with the confirmation the dialog named. When the
  // target changed while the main process was asked, even to the same namespace and back, what it answered
  // is of a choice the operator left: writes are turned off for it, and never shown as on.
  async enableWrites(confirmation: { context: string; namespace: string }): Promise<boolean> {
    const client = this.dependencies.gate;
    const namespace = this.namespace;
    const asked = this.generation;

    if (!client || !namespace || confirmation.namespace !== namespace) return false;
    const answer = await client.enable(this.cluster.id, namespace, confirmation);

    if (!current(this.generation, asked)) {
      await this.disableWrites();
      return false;
    }
    // The main process refused: that is an answer, and what it holds is known. It is asked, and the words
    // of the refusal are kept beside it. Only an answer that was lost leaves the state not known.
    if (!answer.ok && answer.stage !== "way") {
      this.takeGate(await client.state(this.cluster.id));
      runInAction(() => {
        this.gateFailure = answer.text;
      });
      return false;
    }
    this.takeGate(answer);
    return answer.ok;
  }

  async disableWrites(): Promise<void> {
    const client = this.dependencies.gate;

    if (!client) return;
    this.takeGate(await client.disable(this.cluster.id));
  }

  // What the main process answered is the mirror. A failure leaves the state not known, with its reason,
  // until the main process is asked again. With writes that are not on, a write that waits for its
  // confirmation waits for nothing: the main process cleared it.
  private takeGate(answer: Awaited<ReturnType<GateClient["state"]>>): void {
    runInAction(() => {
      if (answer.ok) {
        this.gate = answer.value;
        this.gateFailure = undefined;
      } else {
        this.gate = undefined;
        this.gateFailure = answer.text;
      }
      if (!this.writes.on) this.server.leave();
    });
  }

  // Writes are off when the target changes: the mirror says so at once, and the main process is told
  // whatever the mirror said, which may be behind it: an enable that has not answered yet, or an answer
  // that was lost. Writes are only ever on for a namespace that was the target, so leaving none asks nothing.
  private dropWrites(left: string): void {
    const gate = this.gate;

    if (gate?.writes.on) this.gate = { ...gate, writes: { on: false } };
    if (left && this.dependencies.gate) void this.disableWrites();
  }

  get cluster(): ClusterIdentity {
    return this.dependencies.cluster;
  }

  get configured(): string[] {
    return this.preferences.configured[this.cluster.id] ?? [];
  }

  get choices(): Choice[] {
    return choices(this.found, this.configured);
  }

  get selection(): Selection {
    return selection(this.choices, this.preferences.selected[this.cluster.id], this.found);
  }

  get entry(): Entry {
    return entry(this.api, this.found, this.selection, this.choices);
  }

  // The namespace the views read, when there is one.
  get namespace(): string | undefined {
    return this.entry.state === "ready" ? this.entry.namespace : undefined;
  }

  // The installation is being read, for the first time or again, from the moment a read is asked to the
  // one its last answer is taken.
  get reading(): boolean {
    return this.asking > 0;
  }

  // What was read of a family is plain data of the API, given the type of its family here and nowhere
  // else: every field of it is optional, and the helpers read each one as what it may not be.
  read<Name extends Family>(family: Name): FamilyRead<FamilyItems[Name]> {
    const read = this.reads[family] as FamilyRead<FamilyItems[Name]>;

    return { ...read, status: familyStatus(this.api, family, read.status) };
  }

  // Called by a view when it opens. The first call discovers, the others find what was discovered.
  async open(): Promise<void> {
    if (this.api.state === "unknown") await this.refresh();
  }

  async refresh(): Promise<void> {
    return this.during(async () => {
      runInAction(() => {
        if (this.api.state === "unknown") this.api = { state: "asking" };
        if (this.found.state === "unknown") this.found = { state: "asking" };
      });
      const [discovery, locations] = await Promise.all([
        this.dependencies.read(PATHS.discovery),
        this.dependencies.read(PATHS.locations),
      ]);

      runInAction(() => {
        this.api = apiAvailability(discovery);
        this.found = suggestions(locations);
        this.target();
      });
      await this.readFamilies();
    });
  }

  // A read is counted from the moment it is asked to the one its last answer is taken, whatever it
  // answers.
  private async during(read: () => Promise<void>): Promise<void> {
    runInAction(() => {
      this.asking += 1;
    });
    try {
      await read();
    } finally {
      runInAction(() => {
        this.asking -= 1;
      });
    }
  }

  // The operator chose a namespace among the ones that can be chosen. The choice is kept.
  select(namespace: string): void {
    if (!validNamespace(namespace) || !this.choices.some((choice) => choice.namespace === namespace)) return;
    this.keep((kept) => ({
      ...kept,
      selected: { ...kept.selected, [this.cluster.id]: namespace },
    }));
    this.target();
    void this.readFamilies();
  }

  // The operator named a namespace that no discovery suggested. It becomes one that can be chosen.
  configure(namespace: string): boolean {
    if (!validNamespace(namespace)) return false;
    this.keep((kept) => ({
      ...kept,
      configured: {
        ...kept.configured,
        [this.cluster.id]: [...new Set([...(kept.configured[this.cluster.id] ?? []), namespace])].sort(),
      },
    }));
    this.select(namespace);
    return true;
  }

  // The operator takes back a namespace that was configured. If it was the one selected, none is.
  forget(namespace: string): void {
    const suggested = this.found.state === "listed" && this.found.namespaces.includes(namespace);

    this.keep((kept) => {
      const left = (kept.configured[this.cluster.id] ?? []).filter((name) => name !== namespace);
      const { [this.cluster.id]: _removed, ...others } = kept.configured;
      const { [this.cluster.id]: chosen, ...selections } = kept.selected;

      return {
        ...kept,
        configured: left.length ? { ...others, [this.cluster.id]: left } : others,
        selected: chosen === namespace && !suggested ? selections : kept.selected,
      };
    });
    this.target();
    void this.readFamilies();
  }

  // What the operator allowed the downloads of this cluster to do, as the store of the preferences keeps it.
  get allowances(): Allowance[] {
    return this.preferences.allowances?.[this.cluster.id] ?? [];
  }

  // The operator allows what a download said it needs. The main process is what keeps it, with the moment
  // it was allowed: this window writes nothing of it, and shows it at once, with its own moment, until its
  // store hears of what was kept. The answer is whether it was kept: a download is asked again only then.
  async allow(allowed: AllowanceFor): Promise<boolean> {
    const client = this.dependencies.allowances;

    if (!client) return false;
    const answer = await client.allow(this.cluster.id, allowed);

    runInAction(() => {
      this.allowanceFailure = answer.ok ? undefined : answer.text;
      if (!answer.ok) return;
      this.preferences = {
        ...this.preferences,
        allowances: withAllowance(this.preferences.allowances ?? {}, this.cluster.id, allowed, this.dependencies.now()),
      };
    });
    return answer.ok;
  }

  // The operator takes an allowance back. The main process is what keeps them: it is asked, and what it
  // kept is shown at once, before the store of this window hears of it.
  async takeBack(allowed: AllowanceFor): Promise<void> {
    const client = this.dependencies.allowances;

    if (!client) return;
    const answer = await client.takeBack(this.cluster.id, allowed);

    runInAction(() => {
      this.allowanceFailure = answer.ok ? undefined : answer.text;
      if (!answer.ok) return;
      const { allowances: _before, ...others } = this.preferences;
      const left = withoutAllowance(this.preferences.allowances ?? {}, this.cluster.id, allowed);

      this.preferences = Object.keys(left).length ? { ...others, allowances: left } : others;
    });
  }

  // The window of the recent operations: the one that was chosen, or seven days when none was.
  get window(): Window {
    return readWindow(this.preferences.window);
  }

  // The operator chose how far back the recent operations go. The choice is kept, and asks nothing of the
  // cluster: the operations were read.
  chooseWindow(window: Window): void {
    if (readWindow(window) !== window) return;
    this.keep((kept) => ({ ...kept, window }));
  }

  // A view that is open asks again every so often, for as long as it is: the last one that closes stops it.
  watch(interval = 15_000): () => void {
    this.watchers += 1;
    if (!this.timer) this.timer = setInterval(() => void this.readFamilies(), interval);
    return () => {
      this.watchers -= 1;
      if (this.watchers <= 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
        this.watchers = 0;
      }
    };
  }

  // What is kept is changed from what the store holds now, and not from what this installation read of
  // it when it was made. The store is one for every cluster, and the frame of another cluster may have
  // written to it since: what it wrote would be lost, the window with it.
  private keep(change: (kept: Preferences) => Preferences): void {
    const preferences = change(this.dependencies.storage.read());

    this.preferences = preferences;
    this.dependencies.storage.write(preferences);
  }

  // What another frame kept is taken at every read: the window that was chosen there is the one of here.
  private kept(): void {
    const stored = this.dependencies.storage.read();

    if (JSON.stringify(stored) !== JSON.stringify(this.preferences)) this.preferences = stored;
  }

  // The target of the reads follows the selection. When it changes, what was read of the target before is
  // not of this one: it goes, and what was asked for it will not be taken when it answers.
  private target(): void {
    const namespace = this.namespace ?? "";
    const left = this.generation.namespace;

    if (namespace === left) return;
    this.generation = { cluster: this.cluster.id, namespace, number: this.generation.number + 1 };
    this.reads = emptyReads();
    this.asked = undefined;
    this.server.drop();
    this.dropWrites(left);
  }

  private async readFamilies(): Promise<void> {
    runInAction(() => {
      this.kept();
      this.target();
    });
    return this.during(() => this.readFamiliesOf(this.generation));
  }

  private async readFamiliesOf(asked: Generation): Promise<void> {
    if (!asked.namespace) return;
    const families = FAMILIES.filter((family) => familyStatus(this.api, family, "idle") !== "not-served");

    runInAction(() => {
      this.reads = {
        ...this.reads,
        ...Object.fromEntries(families.map((family) => [family, loading(this.reads[family])])),
      };
    });
    await Promise.all(
      families.map(async (family) => {
        const answer = await this.dependencies.read(PATHS.family(family, asked.namespace));

        runInAction(() => {
          // An answer for a target that is not the one any more: a late one, or of a request that was
          // cancelled and answered all the same.
          if (!current(this.generation, asked)) return;
          const items = (answer.body as { items?: unknown } | undefined)?.items;
          const read =
            typeof answer.status === "number" && answer.status >= 200 && answer.status < 300 && Array.isArray(items)
              ? succeeded(
                  // Only the objects of the namespace that was asked: the answer is not trusted for it.
                  (items as Resource[]).filter((item) => item?.metadata?.namespace === asked.namespace),
                  this.dependencies.now(),
                )
              : failed(this.reads[family], failedStatus(answer.status));

          this.reads = { ...this.reads, [family]: read };
        });
      }),
    );
    runInAction(() => {
      if (current(this.generation, asked)) this.asked = this.dependencies.now();
    });
  }
}
