import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { emptyPreferences, readPreferences } from "./discovery";

import type { PreferenceStorage, Preferences } from "./discovery";

// What is kept between two sessions, in the store the host gives to an extension: the namespace chosen for
// each cluster and the ones configured for it. No object of a cluster, no credential, no permission to write.
// The host writes the file from its main process and passes the changes between its windows: the store is
// opened in both processes, or what a window changes is never written. What the operator allowed the
// downloads to do is kept by the main process alone: there, what a window sends of it is not taken.
export class PreferencesStore extends Common.Store.ExtensionStore<Preferences> implements PreferenceStorage {
  preferences: Preferences = emptyPreferences();
  // Whether this is the process that keeps the allowances, and whether it has read its file.
  private keeper = false;
  private loaded = false;

  constructor() {
    super({ configName: "velero-preferences", defaults: emptyPreferences() });
    makeObservable(this, { preferences: observable.ref });
  }

  // Said by the main process before it loads the store: the allowances are the ones of its file and of
  // its procedures, and of nothing a window sends.
  keepAllowances(): void {
    this.keeper = true;
  }

  // What the host gives the store: its file when it is loaded, and after that what a window changed. A
  // window changes the namespaces and the window of time. In the process that keeps the allowances, what
  // it sends of them is left: a frame of one cluster would otherwise allow for another, around the
  // procedures that check which frame asks.
  fromStore(data: Partial<Preferences>): void {
    const read = readPreferences(data);

    if (this.keeper && this.loaded) {
      const { allowances: _sent, ...others } = read;

      this.preferences = this.preferences.allowances ? { ...others, allowances: this.preferences.allowances } : others;
    } else this.preferences = read;
    this.loaded = true;
  }

  // What the host writes into the file, key by key, removing none: the key of the allowances is always
  // given, empty when nothing is allowed, or one taken back would stay in the file and be allowed again at
  // the next start.
  toJSON(): Preferences {
    const preferences = toJS(this.preferences);

    return { ...preferences, allowances: preferences.allowances ?? {} };
  }

  read(): Preferences {
    return this.preferences;
  }

  write(preferences: Preferences): void {
    this.preferences = readPreferences(preferences);
  }
}
