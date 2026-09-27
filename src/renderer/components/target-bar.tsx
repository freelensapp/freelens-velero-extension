import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { TITLES } from "../../common/discovery";
import { isStale } from "../../common/read-state";
import { ConfigureNamespace } from "./entry-state";
import styles from "./views.module.css";

import type { Family } from "../../common/discovery";
import type { ReadStatus } from "../../common/read-state";
import type { Installation } from "../state/installation";

const {
  Component: { Button, Icon, Select },
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

export function readTime(time: number | undefined): string {
  return time === undefined ? "Not read yet" : `Read at ${new Date(time).toLocaleTimeString()}`;
}

// What says, on every view, which installation is shown: the cluster of the host and the namespace of
// Velero. It is never the namespaces a backup includes, which are data of the backup.
export const TargetBar = observer(({ installation }: { installation: Installation }) => {
  const entry = installation.entry;
  const selected = entry.state === "ready" ? entry.namespace : undefined;
  const [naming, setNaming] = React.useState(false);
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
        <div className={styles.spacer} />
        <span className={styles.readTime} data-testid="velero-read-time">
          {readTime(installation.asked)}
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
    </>
  );
});

// What is missing of the installation that is shown: a namespace that is not found any more, a kind the
// cluster does not serve, a family that cannot be read or whose data are of an earlier read.
export const Coverage = observer(({ installation, families }: { installation: Installation; families: Family[] }) => {
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
  for (const family of families) {
    const read = installation.read(family);
    const reason = REASONS[read.status];

    if (!reason) continue;
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
