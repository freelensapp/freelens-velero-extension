import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import React from "react";
import { validNamespace } from "../../common/discovery";
import styles from "./views.module.css";

import type { Installation } from "../state/installation";

const {
  Component: { Button, Input, Spinner },
} = Renderer;

// The name of a namespace, asked of the operator. It is checked here, before it is part of any request.
export const ConfigureNamespace = observer(
  ({ installation, onConfigured }: { installation: Installation; onConfigured?: () => void }) => {
    const [value, setValue] = React.useState("");
    const [refused, setRefused] = React.useState(false);
    const submit = () => {
      const configured = installation.configure(value.trim());

      setRefused(!configured);
      if (configured) {
        setValue("");
        onConfigured?.();
      }
    };

    return (
      <form
        className={styles.form}
        data-testid="velero-configure"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className={styles.formField}>
          <Input
            theme="round-black"
            aria-label="Namespace of Velero"
            placeholder="Namespace of Velero"
            data-testid="velero-configure-input"
            value={value}
            onChange={(next) => {
              setValue(next);
              setRefused(false);
            }}
          />
        </div>
        <Button primary label="Read this namespace" data-testid="velero-configure-submit" onClick={submit} />
        {refused ? (
          <div className={styles.formError} role="alert" data-testid="velero-configure-error">
            {validNamespace(value.trim())
              ? "The namespace could not be configured."
              : "Not the name of a namespace: lowercase letters, digits and hyphens, 63 characters at most."}
          </div>
        ) : null}
      </form>
    );
  },
);

// What a view shows before any data: one state, with the evidence it comes from and what can be done.
export const EntryState = observer(({ installation }: { installation: Installation }) => {
  const entry = installation.entry;

  switch (entry.state) {
    case "loading":
      return (
        <div className={styles.state} data-testid="velero-state-loading">
          <Spinner />
        </div>
      );
    case "not-installed":
      return (
        <div className={styles.state} data-testid="velero-state-not-installed">
          <div className={styles.stateTitle}>Velero is not installed in this cluster</div>
          <p className={styles.stateText}>
            The cluster answered that it does not serve the API of Velero, <code>velero.io/v1</code>.
          </p>
        </div>
      );
    case "failed":
      return (
        <div className={styles.state} data-testid="velero-state-failed">
          <div className={styles.stateTitle}>The cluster could not be asked about Velero</div>
          <p className={styles.stateText}>
            The request did not get an answer that says whether Velero is installed. It is not known to be absent. Read
            again, or name the namespace of Velero to read it directly.
          </p>
          <ConfigureNamespace installation={installation} />
        </div>
      );
    case "restricted":
      return (
        <div className={styles.state} data-testid="velero-state-restricted">
          <div className={styles.stateTitle}>The API of this cluster cannot be listed</div>
          <p className={styles.stateText}>
            Access to the list of what the cluster serves is denied. Velero may be installed: name its namespace to read
            what your permissions allow there.
          </p>
          <ConfigureNamespace installation={installation} />
        </div>
      );
    case "choose":
      return (
        <div className={styles.state} data-testid="velero-state-choose">
          <div className={styles.stateTitle}>Choose the installation of Velero</div>
          <p className={styles.stateText}>
            More than one namespace of this cluster may hold an installation. None is chosen for you.
          </p>
          <ul className={styles.choices}>
            {entry.choices.map((choice) => (
              <li key={choice.namespace}>
                <button
                  type="button"
                  className={styles.choice}
                  data-testid={`velero-choice-${choice.namespace}`}
                  onClick={() => installation.select(choice.namespace)}
                >
                  <span className={styles.choiceName}>{choice.namespace}</span>
                  <span className={styles.choiceOrigin}>
                    {choice.suggested ? "A backup storage location is here" : "Configured"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.stateText}>The namespace you are looking for is not among these:</p>
          <ConfigureNamespace installation={installation} />
        </div>
      );
    case "configure":
      return (
        <div className={styles.state} data-testid="velero-state-configure">
          <div className={styles.stateTitle}>Name the namespace of Velero</div>
          <p className={styles.stateText}>
            {entry.reason === "no-suggestion"
              ? "The cluster serves the API of Velero and no backup storage location was found in it. An installation without one cannot be found by looking: name its namespace."
              : entry.reason === "suggestions-restricted"
                ? "Access to the backup storage locations of the whole cluster is denied, so the installations cannot be found by looking: name the namespace of yours."
                : "The backup storage locations of the cluster could not be read, so the installations cannot be found by looking: name the namespace of yours, or read again."}
          </p>
          <ConfigureNamespace installation={installation} />
        </div>
      );
    default:
      return null;
  }
});
