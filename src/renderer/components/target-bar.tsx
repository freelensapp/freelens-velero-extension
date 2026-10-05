import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { locationWords } from "../../common/allowances";
import { TITLES } from "../../common/discovery";
import { CONNECTION_REASONS } from "../../common/ipc";
import { isStale } from "../../common/read-state";
import { ConfigureNamespace } from "./entry-state";
import styles from "./views.module.css";

import type { Allowance } from "../../common/allowances";
import type { Family } from "../../common/discovery";
import type { ReadStatus } from "../../common/read-state";
import type { Installation } from "../state/installation";

const {
  Component: { Button, ConfirmDialog, Icon, Select },
} = Renderer;

interface Option {
  value: string;
  label: string;
}

const REASONS: Partial<Record<ReadStatus, string>> = {
  forbidden: "cannot be read: access is denied",
  "not-served": "are not served by this cluster",
  failed: "could not be read",
};

// The words of every reason a connection is refused for are the ones the main process says.
export { CONNECTION_REASONS };

export function readTime(time: number | undefined): string {
  return time === undefined ? "Not read yet" : `Read at ${new Date(time).toLocaleTimeString()}`;
}

// The words of the dialog that turns writes on: what they allow, for which installation of which cluster.
export function writesDialogWords(
  namespace: string,
  cluster: string,
  context: string,
): { first: string; second: string } {
  return {
    first: `Turn writes on for the installation ${namespace} of the cluster ${cluster} (context ${context})?`,
    second:
      "Until they are turned off, or another installation is selected, the extension may create in that namespace the requests the views ask for on purpose: a DownloadRequest for the log, the results, the resources or the volumes of an operation, and a ServerStatusRequest for the version of the server. Each one is confirmed where it is asked for. Nothing else is written.",
  };
}

// The gate of the writes, as the main process last said of it, and the commands that turn it: on, through
// the confirmation dialog of the host, which names the cluster, its context and the namespace; off, at
// once. The state is what the main process holds: the views show it and decide nothing.
export const WritesControl = observer(({ installation }: { installation: Installation }) => {
  const entry = installation.entry;
  const namespace = entry.state === "ready" ? entry.namespace : undefined;
  const gate = installation.gate;
  const writes = installation.writes;
  const unknown = installation.gateUnknown;

  React.useEffect(() => {
    void installation.openGate();
  }, [installation]);
  const turnOn = () => {
    if (!gate || !namespace) return;
    const confirmation = { context: gate.cluster.context, namespace };
    const words = writesDialogWords(namespace, gate.cluster.name, gate.cluster.context);

    ConfirmDialog.open({
      message: (
        <div data-testid="velero-writes-dialog">
          <p>{words.first}</p>
          <p>{words.second}</p>
        </div>
      ),
      labelOk: "Turn writes on",
      labelCancel: "Keep writes off",
      ok: () => installation.enableWrites(confirmation),
    });
  };

  return (
    <div
      className={styles.target}
      data-testid="velero-writes"
      data-writes={unknown ? "unknown" : writes.on ? "on" : "off"}
    >
      <span className={styles.targetLabel}>Writes</span>
      <span className={styles.targetValue} data-testid="velero-writes-state">
        {unknown
          ? "Not known"
          : writes.on
            ? `On for ${writes.namespace} since ${new Date(writes.since).toLocaleTimeString()}`
            : "Off"}
      </span>
      {/* The answer of the main process is not known: they may be on. Asking again says what they are, and
          turning them off is safe whatever they are. */}
      {unknown ? (
        <>
          <Button plain data-testid="velero-writes-ask" onClick={() => void installation.openGate()}>
            <Icon material="refresh" small />
            Ask again
          </Button>
          <Button plain data-testid="velero-writes-off" onClick={() => void installation.disableWrites()}>
            <Icon material="lock" small />
            Turn writes off
          </Button>
        </>
      ) : namespace && gate ? (
        writes.on ? (
          <Button plain data-testid="velero-writes-off" onClick={() => void installation.disableWrites()}>
            <Icon material="lock" small />
            Turn writes off
          </Button>
        ) : (
          <Button plain data-testid="velero-writes-on" onClick={turnOn}>
            <Icon material="lock_open" small />
            Turn writes on
          </Button>
        )
      ) : null}
      {installation.gateFailure ? (
        <span className={styles.muted} data-testid="velero-writes-failure">
          {installation.gateFailure}
        </span>
      ) : null}
      {/* What the main process holds of a connection it does not use, when the reason is not already said
          by the answer that was refused. */}
      {!unknown && !installation.gateFailure && gate?.connection && !gate.connection.supported ? (
        <span className={styles.muted} data-testid="velero-writes-connection">
          {CONNECTION_REASONS[gate.connection.reason]}
        </span>
      ) : null}
    </div>
  );
});

// What an allowance allows, in words: the origin is shown beside them, and nothing of a URL after it.
export function allowanceWords(allowance: Pick<Allowance, "what" | "location">): string {
  return allowance.what === "origin"
    ? `Downloads from this origin, for the storage location ${locationWords(allowance.location)}`
    : allowance.what === "private"
      ? "A connection to a private address of this origin"
      : "A connection to this origin that is not encrypted, made directly from this machine";
}

// What says, on every view, which installation is shown: the cluster of the host and the namespace of
// Velero. It is never the namespaces a backup includes, which are data of the backup.
export const TargetBar = observer(({ installation }: { installation: Installation }) => {
  const entry = installation.entry;
  const selected = entry.state === "ready" ? entry.namespace : undefined;
  const [naming, setNaming] = React.useState(false);
  // What the operator allowed the downloads of this cluster to do is behind a command of its own, which
  // is there only when something was allowed.
  const [allowed, setAllowed] = React.useState(false);
  const allowances = installation.allowances;
  const options: Option[] = installation.choices.map((choice) => ({
    value: choice.namespace,
    label: choice.configured && !choice.suggested ? `${choice.namespace} (configured)` : choice.namespace,
  }));

  // The namespace that is selected stays in the list when nothing suggests it any more.
  if (selected && !options.some((option) => option.value === selected)) {
    options.unshift({ value: selected, label: `${selected} (not found)` });
  }

  return (
    <>
      <div className={styles.targetBar} data-testid="velero-target">
        <div className={styles.target}>
          <span className={styles.targetLabel}>Cluster</span>
          <span className={styles.targetValue} data-testid="velero-target-cluster" title={installation.cluster.name}>
            {installation.cluster.name}
          </span>
        </div>
        <div className={styles.target}>
          <label className={styles.targetLabel} htmlFor="velero-installation">
            Velero namespace
          </label>
          <Select<string, Option, false>
            id="velero-installation"
            inputId="velero-installation"
            className={styles.selector}
            themeName="lens"
            aria-label="Velero namespace"
            placeholder={options.length ? "Choose a namespace" : "None to choose"}
            isDisabled={!options.length}
            options={options}
            value={selected ?? null}
            onChange={(option) => {
              if (option) installation.select(option.value);
            }}
          />
          {/* Where a view is shown the form of the namespaces is behind this: the states before one show it. */}
          {entry.state === "ready" ? (
            <Button
              plain
              aria-expanded={naming}
              aria-controls="velero-namespaces"
              data-testid="velero-namespaces-toggle"
              onClick={() => setNaming(!naming)}
            >
              <Icon material={naming ? "expand_less" : "playlist_add"} small />
              Other namespace
            </Button>
          ) : null}
        </div>
        <WritesControl installation={installation} />
        {allowances.length ? (
          <div className={styles.target}>
            <Button
              plain
              aria-expanded={allowed}
              aria-controls="velero-allowances"
              data-testid="velero-allowances-toggle"
              onClick={() => setAllowed(!allowed)}
            >
              <Icon material={allowed ? "expand_less" : "verified_user"} small />
              Allowed for downloads: {allowances.length}
            </Button>
          </div>
        ) : null}
        <div className={styles.spacer} />
        <span
          className={styles.readTime}
          data-testid="velero-read-time"
          data-reading={installation.reading ? "true" : "false"}
          data-read={installation.asked ?? ""}
        >
          {readTime(installation.asked)}
          {installation.reading ? (installation.asked === undefined ? ", reading" : ", reading again") : ""}
        </span>
        <Button
          plain
          aria-label="Read again"
          data-testid="velero-refresh"
          onClick={() => void installation.refresh()}
          tooltip="Read again"
        >
          <Icon material="refresh" small />
          Read again
        </Button>
      </div>
      {naming && entry.state === "ready" ? (
        <section
          id="velero-namespaces"
          className={styles.namespaces}
          aria-label="Namespaces of Velero"
          data-testid="velero-namespaces"
        >
          <p className={styles.stateText}>
            Name a namespace that was not found by looking for backup storage locations. It is read with your
            permissions, and kept among the ones to choose for this cluster.
          </p>
          <ConfigureNamespace installation={installation} onConfigured={() => setNaming(false)} />
          {installation.configured.length ? (
            <ul className={styles.named} data-testid="velero-namespaces-named">
              {installation.configured.map((namespace) => (
                <li key={namespace}>
                  <span className={styles.choiceName}>{namespace}</span>
                  <Button
                    plain
                    data-testid={`velero-namespaces-forget-${namespace}`}
                    onClick={() => installation.forget(namespace)}
                  >
                    Forget
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {allowed && allowances.length ? (
        <section
          id="velero-allowances"
          className={styles.namespaces}
          aria-label="What is allowed for the downloads"
          data-testid="velero-allowances"
        >
          <p className={styles.stateText}>
            What you allowed the downloads of the artifacts of this cluster to do beyond what its storage locations say.
            Each is kept until you take it back, and holds an origin and nothing of a URL after it.
          </p>
          <ul className={styles.named}>
            {allowances.map((allowance, index) => (
              <li key={`${allowance.what} ${allowance.origin} ${allowance.location ?? ""}`}>
                <span className={styles.choiceName}>{allowance.origin}</span>
                <span>{allowanceWords(allowance)}</span>
                <span className={styles.muted}>since {new Date(allowance.since).toLocaleString()}</span>
                <Button
                  plain
                  data-testid={`velero-allowances-take-back-${index}`}
                  onClick={() =>
                    void installation.takeBack({
                      what: allowance.what,
                      origin: allowance.origin,
                      ...(allowance.location === undefined ? {} : { location: allowance.location }),
                    })
                  }
                >
                  Take back
                </Button>
              </li>
            ))}
          </ul>
          {installation.allowanceFailure ? (
            <span className={styles.muted} role="alert" data-testid="velero-allowances-failure">
              {installation.allowanceFailure}
            </span>
          ) : null}
        </section>
      ) : null}
    </>
  );
});

// What is missing of the installation that is shown: a namespace that is not found any more, a kind the
// cluster does not serve, a family that cannot be read or whose data are of an earlier read.
export interface CoverageProps {
  installation: Installation;
  families: Family[];
  // The families a list takes a column from. What a row says of them says when they are not known; what
  // no row says is that what it shows of them is of an earlier read.
  earlier?: Family[];
}

export const Coverage = observer(({ installation, families, earlier = [] }: CoverageProps) => {
  const entry = installation.entry;

  if (entry.state !== "ready") return null;
  const notices: { key: string; level: "warning" | "error" | "info"; text: string }[] = [];

  if (entry.stale) {
    notices.push({
      key: "stale-selection",
      level: "warning",
      text: `No storage location is in ${entry.namespace} any more and the namespace is not configured. It stays selected: choose another one to change it.`,
    });
  }
  for (const family of [...families, ...earlier.filter((family) => !families.includes(family))]) {
    const read = installation.read(family);
    const reason = REASONS[read.status];

    if (!reason) continue;
    if (!families.includes(family) && !isStale(read)) continue;
    notices.push({
      key: family,
      level: read.status === "failed" ? "error" : "warning",
      text: isStale(read)
        ? `${TITLES[family]} ${reason}. What is shown was read at ${new Date(read.lastSuccess ?? 0).toLocaleTimeString()}.`
        : `${TITLES[family]} ${reason}.`,
    });
  }
  if (!notices.length) return null;

  return (
    <div data-testid="velero-coverage">
      {notices.map((notice) => (
        <div
          key={notice.key}
          role="status"
          data-testid={`velero-notice-${notice.key}`}
          className={`${styles.notice} ${
            notice.level === "error"
              ? styles.noticeError
              : notice.level === "warning"
                ? styles.noticeWarning
                : styles.noticeInfo
          }`}
        >
          <Icon material={notice.level === "error" ? "error_outline" : "warning_amber"} small />
          <span>{notice.text}</span>
        </div>
      ))}
    </div>
  );
});
