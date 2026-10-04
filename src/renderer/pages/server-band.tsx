import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { REQUEST_LABELS, REQUEST_PREFIX } from "../../common/ipc";
import { hasItems } from "../../common/read-state";
import { compareVersion, pluginGroups, providerPlugins, versionNote } from "../../common/server-version";
import { REVIEWED_RELEASE } from "../../common/types";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { focusFirst } from "../components/views-frame";
import { WriteConfirmation } from "../components/write-confirmation";

import type { ServerStatusValue } from "../../common/ipc";
import type { FamilyRead } from "../../common/read-state";
import type { PluginGroup } from "../../common/server-version";
import type { BackupStorageLocationResource } from "../../common/types";
import type { Installation } from "../state/installation";
import type { RequestLeft } from "../state/server-status";

const {
  Component: { Button, Icon },
} = Renderer;

const ID = "velero-overview-server";
const KIND = "ServerStatusRequest";
// What becomes of a request, which the band says of one that is there or may be.
const STAYS =
  "The extension deletes no request: the server deletes one when it looks at it again, five minutes after it processed it, and one that no server processes stays until someone removes it.";

type Locations = FamilyRead<BackupStorageLocationResource>;

// The time the server wrote, in the words of the page when it is a time, and as it is written when not.
function processedText(processed: string): string {
  const at = Date.parse(processed);

  return Number.isFinite(at) ? time(at) : processed;
}

// How many plugins the server loaded, and what the request lists more than once: each plugin is one.
function pluginsCount(total: number, repeated: number): string {
  const loaded = total === 0 ? "No plugin loaded." : total === 1 ? "1 plugin loaded." : `${total} plugins loaded.`;

  if (repeated === 0) return loaded;
  return `${loaded} The request lists ${total + repeated} entries: ${repeated} ${repeated === 1 ? "repeats" : "repeat"} a plugin of the same kind, which is shown once.`;
}

// The providers of the storage locations beside the object store plugins: the plugin each one needs, by
// the rule of the release, and whether the server loaded it. The locations are the ones the installation
// read last, which the band is given: they are read again while the version stays.
function Providers({ locations, read }: { locations: Locations; read: ServerStatusValue }) {
  if (!hasItems(locations))
    return (
      <p className={styles.factNote} data-testid={`${ID}-providers-unknown`}>
        The providers of the storage locations are not known: the storage locations were not read.
      </p>
    );
  const providers = providerPlugins(locations.items, read.plugins);

  if (!providers.length)
    return (
      <p className={styles.factNote} data-testid={`${ID}-providers-none`}>
        No storage location of this installation names a provider.
      </p>
    );
  return (
    <ul
      className={styles.serverProviders}
      data-testid={`${ID}-providers`}
      aria-label="Providers of the storage locations"
    >
      {providers.map((line) => (
        <li key={line.provider} data-provider={line.provider} data-loaded={line.loaded}>
          <Icon material={line.loaded ? "check" : "warning_amber"} small aria-hidden />
          <span>
            The provider {line.provider} of the storage {line.locations.length === 1 ? "location" : "locations"}{" "}
            {line.locations.join(", ")} needs the object store plugin {line.plugin}, which is{" "}
            {line.loaded ? "loaded" : <strong>not loaded</strong>}.
          </span>
        </li>
      ))}
    </ul>
  );
}

function Plugins({ locations, read }: { locations: Locations; read: ServerStatusValue }) {
  const { groups, total, repeated } = pluginGroups(read.plugins);

  return (
    <>
      <p className={styles.factNote} data-testid={`${ID}-plugins-count`}>
        {pluginsCount(total, repeated)}
      </p>
      <div className={styles.scrolled}>
        <table className={styles.references} data-testid={`${ID}-plugins`}>
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Plugins</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group: PluginGroup) => (
              <tr key={group.kind} data-kind={group.kind} data-count={group.count}>
                <td>
                  <span className={styles.short}>{group.kind}</span> <span className={styles.muted}>{group.count}</span>
                  {group.known ? null : <div className={styles.factNote}>Not a kind of the reviewed release</div>}
                </td>
                <td>
                  {group.count ? (
                    <ul className={styles.serverNames}>
                      {group.names.map((name) => (
                        <li key={name} data-plugin>
                          {name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className={styles.muted}>None loaded</span>
                  )}
                  {group.kind === "ObjectStore" ? <Providers locations={locations} read={read} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Version({ locations, read }: { locations: Locations; read: ServerStatusValue }) {
  const found = compareVersion(read.version, REVIEWED_RELEASE);

  return (
    <>
      {/* The answer of a command given a moment before: it is given the focus when it arrives, which shows
          it and says it to who does not see. */}
      <p
        className={`${styles.overviewCount} ${styles.serverFocus}`}
        data-testid={`${ID}-version`}
        data-relation={found.relation}
        tabIndex={-1}
      >
        Velero {read.version}
      </p>
      <p className={styles.factNote} data-testid={`${ID}-note`}>
        {versionNote(found)}
      </p>
      <p className={styles.factNote} data-testid={`${ID}-processed`}>
        Processed by the server at {processedText(read.processed)}
      </p>
      <Plugins locations={locations} read={read} />
      <p className={styles.factNote} data-testid={`${ID}-request`}>
        The server deletes the request {read.request.name} when it looks at it again, five minutes after it processed
        it.
      </p>
    </>
  );
}

// Where the request of a write that failed is, when it is there or may be.
function RequestNote({ left, namespace }: { left: RequestLeft; namespace: string }) {
  if (left === "none") return null;
  return (
    <p className={styles.factNote} data-testid={`${ID}-failure-request`} data-request={left}>
      {left === "created"
        ? `The request is a ${KIND} of ${namespace} whose name begins with ${REQUEST_PREFIX}.`
        : `It is not known whether the request was created: a ${KIND} whose name begins with ${REQUEST_PREFIX} may be in ${namespace}.`}{" "}
      {STAYS}
    </p>
  );
}

// The band of the server in the Overview: the version of the server and its plugins, asked of the server
// itself through a ServerStatusRequest, which is a write. It is not read when the page opens: the
// operator asks for it, through the gate and its confirmation, here in the band.
export const ServerBand = observer(({ installation }: { installation: Installation }) => {
  const server = installation.server;
  const step = server.step;
  const last = server.last;
  const writes = installation.writes;
  const namespace = installation.namespace ?? "";
  const gate = installation.gate;
  // Read here, where the band follows what the installation reads: the parts under it are given it.
  const locations = installation.read("storageLocations");
  // A request of this band is in the namespace already, or may be.
  const left = step.state === "failed" ? step.request : "none";
  const another = last !== undefined || left !== "none";
  // What the command does, said before it is given.
  const what = another
    ? `Asking again creates another ${KIND} in ${namespace}.`
    : `Asking the server for them creates a ${KIND} in ${namespace}, which the server answers.`;
  // What the band is doing while the main process is asked: no command is offered meanwhile, whatever
  // the state of the writes becomes, since a request that runs is not left.
  const busy =
    step.state === "asking"
      ? "Asking the main process for the confirmation of the request."
      : step.state === "running"
        ? `Creating the ${KIND}, then waiting for the server to answer for ten seconds at most.`
        : "";
  // The views have no way to the main process: writes cannot be turned on, here or in the target bar.
  const noWay = !gate && installation.gateFailure !== undefined && !installation.gateUnknown;
  const body = React.useRef<HTMLDivElement>(null);
  const status = React.useRef<HTMLDivElement>(null);
  // A gesture of the band changed what it shows: the control that was used went with it.
  const gesture = React.useRef(false);
  const by = (act: () => void) => () => {
    gesture.current = true;
    act();
  };
  // What the server answered last, as the band last showed it.
  const answer = React.useRef(last);

  // The focus of a control that went is given to what took its place: while the main process is asked,
  // the words that say so; then the version the server answered, which is at the top of the band and far
  // from the command under it, the confirmation, or the command. When the operator moved to something
  // else in the meantime the focus is theirs.
  React.useEffect(() => {
    const answered = last !== undefined && last !== answer.current;

    answer.current = last;
    if (!gesture.current) return;
    if (!busy) gesture.current = false;
    const active = document.activeElement;

    if (active && active !== document.body && active !== status.current && document.body.contains(active)) return;
    if (busy) status.current?.focus();
    else
      focusFirst(body.current, [
        ...(answered ? [`[data-testid="${ID}-version"]`] : []),
        `[data-testid="${ID}-confirm"]`,
        `[data-testid="${ID}-create"]`,
        `[data-testid="${ID}-to-target"]`,
      ]);
  }, [busy, step.state, last]);

  // A confirmation is left with the page that shows it.
  React.useEffect(() => () => server.leave(), [server]);

  return (
    <div ref={body} data-testid={`${ID}-body`} data-server={last ? "read" : "unread"} data-step={step.state}>
      {last ? (
        <Version locations={locations} read={last} />
      ) : (
        <p className={styles.stateText} data-testid={`${ID}-unread`}>
          The version of the server and its plugins are not read.
        </p>
      )}
      {step.state === "failed" ? (
        <div data-testid={`${ID}-failure`} data-code={step.failure.code} data-stage={step.failure.stage} role="alert">
          <p className={styles.stateText} data-testid={`${ID}-failure-text`}>
            {step.failure.text}
          </p>
          <RequestNote left={left} namespace={namespace} />
        </div>
      ) : null}
      {/* What the band is doing, said to who does not see: the part is always there, and its words change. */}
      <div
        ref={status}
        role="status"
        tabIndex={-1}
        className={busy ? `${styles.factNote} ${styles.serverFocus}` : undefined}
        data-testid={`${ID}-status`}
      >
        {busy}
      </div>
      {busy ? null : !writes.on ? (
        <>
          <p className={styles.factNote} data-testid={`${ID}-writes-off`}>
            {what}{" "}
            {noWay
              ? installation.gateFailure
              : installation.gateUnknown
                ? "Whether writes are on is not known: the target bar asks the main process again."
                : "Writes are off for this installation: they are turned on in the target bar."}
          </p>
          {noWay ? null : (
            <div className={styles.writeActions}>
              <button
                type="button"
                className={styles.link}
                data-testid={`${ID}-to-target`}
                onClick={(event) =>
                  focusFirst(event.currentTarget.ownerDocument.body, [
                    '[data-testid="velero-writes-on"]',
                    '[data-testid="velero-writes-ask"]',
                  ])
                }
              >
                Go to the writes in the target bar
              </button>
            </div>
          )}
        </>
      ) : step.state === "confirming" ? (
        <WriteConfirmation
          id={`${ID}-confirm`}
          object={{
            kind: KIND,
            apiVersion: "velero.io/v1",
            name: { prefix: REQUEST_PREFIX },
            namespace,
            cluster: gate?.cluster.name ?? installation.cluster.name,
            context: gate?.cluster.context ?? "",
            labels: REQUEST_LABELS,
            spec: "Empty",
            target: "None: the request is of the server, not of an object",
          }}
          onCreate={by(() => void server.run())}
          onBack={by(() => server.leave())}
        />
      ) : (
        <>
          <p className={styles.factNote} data-testid={`${ID}-what`}>
            {what}
          </p>
          <div className={styles.writeActions}>
            <Button plain data-testid={`${ID}-create`} onClick={by(() => void server.ask())}>
              <Icon material="add_circle_outline" small />
              {another ? `Create another ${KIND}` : `Create a ${KIND}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
});
