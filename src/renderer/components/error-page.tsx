import styles from "./views.module.css";

import type { ReactNode } from "react";

export interface ErrorPageProps {
  error?: unknown;
  children?: ReactNode;
}

// What is shown in place of a page or of a section of the details that threw while it was drawn: the error,
// and where it is kept. The boundary that draws it has given the error to the log of the host.
export function ErrorPage({ error, children }: ErrorPageProps) {
  return (
    <div className={styles.state} role="alert" data-testid="velero-error-page">
      <div className={styles.stateTitle}>The extension for Velero could not show this</div>
      {error ? <p className={styles.errorMessage}>{String(error)}</p> : null}
      <p className={styles.stateText}>The log of Freelens has the error, with the name of the extension.</p>
      {children}
    </div>
  );
}
