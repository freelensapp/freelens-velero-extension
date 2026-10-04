import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { REQUEST_LABELS, REQUEST_PREFIX } from "../../common/ipc";
import { hasItems } from "../../common/read-state";
import { compareVersion, pluginGroups, providerPlugins, versionNote } from "../../common/server-version";
import { REVIEWED_RELEASE } from "../../common/types";
import { time } from "../components/status";
import styles from "../components/views.module.css";
import { focusFirst } from "../components/views-frame";
import { WriteConfirmation } from "../components/write-confirmation";

import type { PluginGroup, ProviderPlugin } from "../../common/server-version";
import type { Installation } from "../state/installation";
import type { ServerRead } from "../state/server-status";

const {
  Component: { Button },
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
          {line.provider}, of {line.locations.join(", ")}: needs {line.plugin}, which is{" "}
          {line.loaded ? "loaded" : <strong>not loaded</strong>}
        </li>
      ))}
    </ul>
  );
}

function Plugins({ installation, read }: { installation: Installation; read: ServerRead }) {
  const { groups, total } = pluginGroups(read.value.plugins);
  const providers = providerPlugins(installation.read("storageLocations").items, read.value.plugins);

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

function Version({ installation, read }: { installation: Installation; read: ServerRead }) {
  const found = compareVersion(read.value.version, REVIEWED_RELEASE);

  return (
    <>
      <p className={styles.overviewCount} data-testid={`${ID}-version`} data-relation={found.relation}>
        Velero {read.value.version}
      </p>
      <p className={styles.factNote} data-testid={`${ID}-note`}>
        {versionNote(found)}
      </p>
      <p className={styles.factNote} data-testid={`${ID}-processed`}>
        Processed by the server at {processedText(read.value.processed)}
      </p>
      <Plugins installation={installation} read={read} />
      <p className={styles.factNote} data-testid={`${ID}-request`}>
        The server deletes the request {read.value.request.name} when it looks at it again, five minutes after it
        processed it.
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
  const another = last !== undefined || (step.state === "failed" && step.failure.stage === "wait");

  return (
    <div data-testid={`${ID}-body`} data-server={last ? "read" : "unread"} data-step={step.state}>
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
          {step.failure.code === "deadline" ? (
            <p className={styles.factNote} data-testid={`${ID}-failure-deletion`}>
              When the server processes it, it deletes it when it looks at it again, five minutes after.
            </p>
          ) : null}
        </div>
      ) : null}
      {!writes.on ? (
        <div className={styles.writeActions}>
          <p className={styles.factNote} data-testid={`${ID}-writes-off`}>
            Reading them creates a {KIND} in {namespace}, which the server answers.{" "}
            {installation.gateUnknown
              ? "Whether writes are on is not known: the target bar asks the main process again."
              : "Writes are off for this installation: they are turned on in the target bar."}
          </p>
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
          onCreate={() => void server.run()}
          onBack={() => server.back()}
        />
      ) : step.state === "running" ? (
        <p className={styles.factNote} role="status" data-testid={`${ID}-running`}>
          Creating the {KIND} and waiting for the server to answer, for ten seconds at most.
        </p>
      ) : (
        <div className={styles.writeActions}>
          <Button primary data-testid={`${ID}-create`} onClick={() => void server.ask()}>
            {another ? `Create another ${KIND}` : `Create a ${KIND}`}
          </Button>
        </div>
      )}
    </div>
  );
});
