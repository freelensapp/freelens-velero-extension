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
import type { PluginGroup, ProviderPlugin } from "../../common/server-version";
import type { Installation } from "../state/installation";

const {
  Component: { Button, Icon },
} = Renderer;

const ID = "velero-overview-server";
const KIND = "ServerStatusRequest";

// The time the server wrote, in the words of the page when it is a time, and as it is written when not.
function processedText(processed: string): string {
  const at = Date.parse(processed);

  return Number.isFinite(at) ? time(at) : processed;
}

function pluginsCount(total: number): string {
  if (total === 0) return "No plugin loaded.";
  return total === 1 ? "1 plugin loaded." : `${total} plugins loaded.`;
}

// The providers of the storage locations beside the object store plugins: the plugin each one needs, by
// the rule of the release, and whether the server loaded it.
function Providers({ installation, providers }: { installation: Installation; providers: ProviderPlugin[] }) {
  const read = installation.read("storageLocations");

  if (!hasItems(read))
    return (
      <p className={styles.factNote} data-testid={`${ID}-providers-unknown`}>
        The providers of the storage locations are not known: the storage locations were not read.
      </p>
    );
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

function Plugins({ installation, read }: { installation: Installation; read: ServerStatusValue }) {
  const { groups, total } = pluginGroups(read.plugins);
  const providers = providerPlugins(installation.read("storageLocations").items, read.plugins);

  return (
    <>
      <p className={styles.factNote} data-testid={`${ID}-plugins-count`}>
        {pluginsCount(total)}
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
                      {group.names.map((name, index) => (
                        // A name may be listed twice by the server: the place keeps the two apart.
                        <li key={`${name}/${index}`} data-plugin>
                          {name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className={styles.muted}>None loaded</span>
                  )}
                  {group.kind === "ObjectStore" ? (
                    <Providers installation={installation} providers={providers} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Version({ installation, read }: { installation: Installation; read: ServerStatusValue }) {
  const found = compareVersion(read.version, REVIEWED_RELEASE);

  return (
    <>
      {/* Said to who does not see when it arrives: it is the answer of a command given a moment before. */}
      <p className={styles.overviewCount} data-testid={`${ID}-version`} data-relation={found.relation} role="status">
        Velero {read.version}
      </p>
      <p className={styles.factNote} data-testid={`${ID}-note`}>
        {versionNote(found)}
      </p>
      <p className={styles.factNote} data-testid={`${ID}-processed`}>
        Processed by the server at {processedText(read.processed)}
      </p>
      <Plugins installation={installation} read={read} />
      <p className={styles.factNote} data-testid={`${ID}-request`}>
        The server deletes the request {read.request.name} when it looks at it again, five minutes after it processed
        it.
      </p>
    </>
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
  // A request of this band may be in the namespace already: one that was answered, one that was created
  // and not answered, one whose creation is not known.
  const another =
    last !== undefined ||
    (step.state === "failed" && (step.failure.stage === "wait" || step.failure.code === "submission-unknown"));
  // What the command does, said before it is given.
  const what = another
    ? `Asking again creates another ${KIND} in ${namespace}.`
    : `Asking the server for them creates a ${KIND} in ${namespace}, which the server answers.`;
  const body = React.useRef<HTMLDivElement>(null);
  // A gesture of the band changed what it shows: the control that was used went with it.
  const gesture = React.useRef(false);
  const by = (act: () => void) => () => {
    gesture.current = true;
    act();
  };

  // The focus of a control that went is given to what took its place, once the main process answered: the
  // confirmation, or the command. When the operator moved to something else in the meantime it is theirs.
  React.useEffect(() => {
    if (!gesture.current || step.state === "asking" || step.state === "running") return;
    gesture.current = false;
    const active = document.activeElement;

    if (active && active !== document.body && document.body.contains(active)) return;
    focusFirst(body.current, [
      `[data-testid="${ID}-confirm"]`,
      `[data-testid="${ID}-create"]`,
      `[data-testid="${ID}-to-target"]`,
    ]);
  }, [step.state]);

  // A confirmation is left with the page that shows it.
  React.useEffect(() => () => server.back(), [server]);

  return (
    <div ref={body} data-testid={`${ID}-body`} data-server={last ? "read" : "unread"} data-step={step.state}>
      {last ? (
        <Version installation={installation} read={last} />
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
          {step.failure.stage === "wait" ? (
            <p className={styles.factNote} data-testid={`${ID}-failure-request`}>
              The request is a {KIND} of {namespace} whose name begins with {REQUEST_PREFIX}. The extension deletes no
              request: the server deletes one when it looks at it again, five minutes after it processed it, and one
              that no server processes stays until someone removes it.
            </p>
          ) : null}
        </div>
      ) : null}
      {!writes.on ? (
        <>
          <p className={styles.factNote} data-testid={`${ID}-writes-off`}>
            {what}{" "}
            {installation.gateUnknown
              ? "Whether writes are on is not known: the target bar asks the main process again."
              : "Writes are off for this installation: they are turned on in the target bar."}
          </p>
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
        </>
      ) : step.state === "asking" ? (
        <p className={styles.factNote} role="status" data-testid={`${ID}-asking`}>
          Asking the main process for the confirmation of the request.
        </p>
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
          onBack={by(() => server.back())}
        />
      ) : step.state === "running" ? (
        <p className={styles.factNote} role="status" data-testid={`${ID}-running`}>
          Creating the {KIND} and waiting for the server to answer, for ten seconds at most.
        </p>
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
