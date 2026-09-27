import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { emptyPreferences, readPreferences } from "./discovery";

import type { PreferenceStorage, Preferences } from "./discovery";

// What is kept between two sessions, in the store the host gives to an extension: the namespace chosen for
// each cluster and the ones configured for it. No object of a cluster, no credential, no permission to write.
// The host writes the file from its main process and passes the changes between its windows: the store is
// opened in both processes, or what a window changes is never written.
export class PreferencesStore extends Common.Store.ExtensionStore<Preferences> implements PreferenceStorage {
  preferences: Preferences = emptyPreferences();

  constructor() {
    super({ configName: "velero-preferences", defaults: emptyPreferences() });
    makeObservable(this, { preferences: observable.ref });
  }

  fromStore(data: Partial<Preferences>): void {
    this.preferences = readPreferences(data);
  }

  toJSON(): Preferences {
    return toJS(this.preferences);
  }

  read(): Preferences {
    return this.preferences;
  }

  write(preferences: Preferences): void {
    this.preferences = readPreferences(preferences);
  }
}
