import { action, computed, makeObservable, observable, runInAction } from "mobx";
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
import type { FamilyRead } from "../../common/read-state";
import type { VeleroResource } from "../../common/types";

// What asks the cluster: one verb, and the status of the answer beside its body.
export type Reader = (path: string, signal?: AbortSignal) => Promise<Answer>;

export type Resource = VeleroResource<unknown, unknown>;
export type Reads = Record<Family, FamilyRead<Resource>>;

export interface ClusterIdentity {
  id: string;
  name: string;
}

export interface InstallationDependencies {
  cluster: ClusterIdentity;
  read: Reader;
  now: () => number;
  storage: PreferenceStorage;
}

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
  private readonly dependencies: InstallationDependencies;
  private watchers = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(dependencies: InstallationDependencies) {
    this.dependencies = dependencies;
    this.preferences = dependencies.storage.read();
    this.generation = { cluster: dependencies.cluster.id, namespace: "", number: 0 };
    makeObservable(this, {
      api: observable.ref,
      found: observable.ref,
      preferences: observable.ref,
      generation: observable.ref,
      reads: observable.ref,
      asked: observable,
      choices: computed,
      selection: computed,
      entry: computed,
      namespace: computed,
      select: action,
      configure: action,
      forget: action,
    });
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

  read(family: Family): FamilyRead<Resource> {
    const read = this.reads[family];

    return { ...read, status: familyStatus(this.api, family, read.status) };
  }

  // Called by a view when it opens. The first call discovers, the others find what was discovered.
  async open(): Promise<void> {
    if (this.api.state === "unknown") await this.refresh();
  }

  async refresh(): Promise<void> {
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
  }

  // The operator chose a namespace among the ones that can be chosen. The choice is kept.
  select(namespace: string): void {
    if (!validNamespace(namespace) || !this.choices.some((choice) => choice.namespace === namespace)) return;
    this.keep({
      ...this.preferences,
      selected: { ...this.preferences.selected, [this.cluster.id]: namespace },
    });
    this.target();
    void this.readFamilies();
  }

  // The operator named a namespace that no discovery suggested. It becomes one that can be chosen.
  configure(namespace: string): boolean {
    if (!validNamespace(namespace)) return false;
    this.keep({
      ...this.preferences,
      configured: {
        ...this.preferences.configured,
        [this.cluster.id]: [...new Set([...this.configured, namespace])].sort(),
      },
    });
    this.select(namespace);
    return true;
  }

  // The operator takes back a namespace that was configured. If it was the one selected, none is.
  forget(namespace: string): void {
    const left = this.configured.filter((name) => name !== namespace);
    const { [this.cluster.id]: _removed, ...others } = this.preferences.configured;
    const { [this.cluster.id]: chosen, ...selections } = this.preferences.selected;
    const suggested = this.found.state === "listed" && this.found.namespaces.includes(namespace);

    this.keep({
      configured: left.length ? { ...others, [this.cluster.id]: left } : others,
      selected: chosen === namespace && !suggested ? selections : this.preferences.selected,
    });
    this.target();
    void this.readFamilies();
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

  private keep(preferences: Preferences): void {
    this.preferences = preferences;
    this.dependencies.storage.write(preferences);
  }

  // The target of the reads follows the selection. When it changes, what was read of the target before is
  // not of this one: it goes, and what was asked for it will not be taken when it answers.
  private target(): void {
    const namespace = this.namespace ?? "";

    if (namespace === this.generation.namespace) return;
    this.generation = { cluster: this.cluster.id, namespace, number: this.generation.number + 1 };
    this.reads = emptyReads();
    this.asked = undefined;
  }

  private async readFamilies(): Promise<void> {
    const asked = this.generation;

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
