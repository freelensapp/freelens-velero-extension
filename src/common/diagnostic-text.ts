// The words of every way a request to Velero ends without its result, by its code and by the step it
// ended at. They are written once, for the tabs of the artifacts and for the band of the server: the same
// failure is said the same way wherever it is shown. Nothing of a URL, of a header, of a body or of the
// path of a file is in them: they are given the names of the objects, and nothing else.

import { locationWords } from "./allowances";
import { type ArtifactTarget, artifactKind, type Failure, type FailureCode, failure } from "./ipc";

import type { AllowanceFor } from "./allowances";

// What the main process says of an API server it could not ask, whatever it asked it.
export const API_WORDS = {
  unreachable: "The API server of the cluster could not be reached.",
  untrusted: "The certificate of the API server of the cluster is not trusted.",
  changed: "The cluster or the installation changed while the request was made.",
  unnamed: "The request could not be made, for a reason the extension does not name.",
  late: "The cluster did not answer in time.",
} as const;

// What is said of a store whose connection was not trusted. The transport tells a certificate that was
// refused from a handshake that failed for another reason, as of a store that does not speak TLS on that
// port: only the first is something the certificate of a location, or what a location asks of the
// verification, has to do with. Where it is not known which it was, the words name both.
const STORE_CERTIFICATE = "The certificate of the store is not trusted.";
const STORE_HANDSHAKE =
  "The handshake of TLS with the store failed, and no certificate was refused: the store may not speak TLS at the port of its URL, or a version of it the extension does not, or the connection was closed while it was made.";
const STORE_UNTRUSTED =
  "The connection to the store was not trusted: its certificate was refused, or the handshake of TLS failed.";
// What an operator can do about a certificate that is not trusted.
const NAME_THE_AUTHORITY =
  "The storage location can name the certificate of its authority; the verification is never turned off.";

// A plugin of the context that gave no credential: the cluster was not asked, so it refused nothing. The
// command is named by its file alone.
export function pluginWords(command: string, reason: "failed" | "deadline" | "unreadable", seconds: number): string {
  const plugin = `The credential plugin ${command} of the context`;

  return reason === "deadline"
    ? `${plugin} did not give a credential in ${seconds} seconds. Run it in a terminal to see what it waits for, then ask again.`
    : reason === "unreadable"
      ? `${plugin} ended, but what it printed is not a credential the extension can read.`
      : `${plugin} did not give a credential: it failed, or it is not installed. Run it in a terminal, for example to sign in again, then ask again.`;
}

// What the way of a request found by itself, where the code alone does not say it. The same code at the
// same step is also what the cluster answers a read with: a read of the request the cluster did not answer
// in time is not a request Velero did not sign, and the words tell them apart.
//   unsigned: the request carried no URL at the bound of the wait;
//   failed: the request says that Velero could not process it;
//   expired: the request says that it expired already;
//   another: the request of that name is not the one that was created;
//   replaced: the target of that name is not the object that was confirmed;
//   whole: the bound of the whole operation was reached, at whatever step;
//   untrusted: the certificate of the store was refused, which a handshake of TLS that failed for another
//   reason is told from;
//   insecure: the certificate of the store was refused, and its storage location asks that it is not
//   verified, which the extension does not do.
// And the rule that denies a destination, which is one code for all of them:
//   url: the URL is not of HTTP or HTTPS, or carries a user or a fragment;
//   public-url: the location signs over its public URL, and the URL is of the URL of its store;
//   path: the path of the URL is not the key of the artifact that was asked;
//   ambiguous: the host is a Service of the cluster and a name of this machine as well;
//   port: the port of the URL is not one of the Service, or its Pod does not listen on it;
//   endpoint: the Service has no endpoint that is ready and is a Pod;
//   address: the host gives no address the extension connects to;
//   allowance: the operator may allow it, and the failure says what.
// And of a refusal of the cluster:
//   candidate: the host of the store may be a Service or a name of this machine, and the read that tells
//   was refused;
//   credential: the cluster did not take the credential of the context, which says nothing of what the
//   identity may do.
export type DownloadVerdict =
  | "unsigned"
  | "failed"
  | "expired"
  | "another"
  | "replaced"
  | "whole"
  | "untrusted"
  | "insecure"
  | "url"
  | "public-url"
  | "path"
  | "ambiguous"
  | "port"
  | "endpoint"
  | "address"
  | "allowance"
  | "candidate"
  | "credential";

export interface DownloadContext {
  artifact: ArtifactTarget;
  // The backup or the restore the artifact is of, and the namespace of its installation.
  name: string;
  namespace: string;
  // The name of the request, once it is in the cluster or may be.
  request?: string;
  // The plugin of the context that gave no credential, by the file of its command, with its bound.
  plugin?: { command: string; reason: "failed" | "deadline" | "unreadable"; seconds: number };
  verdict?: DownloadVerdict;
  // What the operator may allow for the request to go on, when that is what denied its destination.
  needs?: AllowanceFor;
}

// The steps before the request is created, and the ones after it is in the cluster. The creation is
// neither: each way of ending at it says what it knows of the request. Neither is a step this function
// does not know, of which nothing is claimed.
const BEFORE_THE_CREATION = ["queue", "target", "backup", "location", "certificate"];
const AFTER_THE_CREATION = [
  "wait",
  "route",
  "service",
  "endpoints",
  "pod",
  "forward",
  "download",
  "delivery",
  "release",
];
// The reads of the route through the cluster, and what each asks of the identity: the tab says which was
// refused, and what the tunnel needs.
// A port-forward over a WebSocket is asked of the API server with the verb get, and the releases that
// check the verb create for it as well ask for both.
const ROUTE_READS: Record<string, { refused: string; needs: string }> = {
  service: { refused: "to read the Service of the store", needs: "the verb get on services" },
  endpoints: {
    refused: "to list the endpoint slices of the Service of the store",
    needs: "the verb list on endpointslices",
  },
  pod: { refused: "to read the Pod of the store", needs: "the verb get on pods" },
  forward: {
    refused: "the port-forward to the Pod of the store",
    needs: "the verbs get and create on pods/portforward",
  },
};
// The words of each rule that denies a destination.
const DENIED: Partial<Record<DownloadVerdict, string>> = {
  url: "The URL of the request is not one the extension takes: it is not of HTTP or HTTPS, or it carries a user or a fragment.",
  "public-url":
    "The storage location signs over its public URL, and the URL of the request is of the URL of its store: it is not one Velero signed for this location.",
  path: "The URL of the request is not of the file that was asked: its path is not the one of this artifact in the bucket of the storage location. Nothing was fetched.",
  ambiguous:
    "The host of the store is a Service of the cluster and a name this machine resolves as well: it is not known which of the two Velero signed for.",
  port: "The port of the URL is not one the Service of the store has, or its Pod does not declare the port the Service sends it to.",
  endpoint: "The Service of the store has no Pod that is ready, among the ones it selects, to send the request to.",
  address:
    "The name of the store gives no address the extension connects to: an address of this machine, of the link or of a metadata service is never one.",
};
// The steps at which the target itself is read.
const OF_THE_TARGET = ["target", "delivery"];

// What a failure of a DownloadRequest says: its code, its stage, whether asking again as it was asked is
// safe, and its words.
export function downloadFailure(code: FailureCode, stage: string, context: DownloadContext): Failure {
  const kind = artifactKind(context.artifact).toLowerCase();
  const target = `the ${kind} ${context.name}`;
  const named = context.request ? `the DownloadRequest ${context.request}` : "a DownloadRequest";
  const request = context.request ? `The DownloadRequest ${context.request}` : "The DownloadRequest";
  const before = BEFORE_THE_CREATION.includes(stage);
  const created = AFTER_THE_CREATION.includes(stage);
  // The step at which the store, and not the cluster, is asked.
  const store = stage === "download";
  // What becomes of a request that was created: the extension deletes none.
  const stays = `${request} stays in ${context.namespace} until Velero removes it.`;
  const none = "No request was created.";
  // What is known of a request whose creation was interrupted: that it may be there.
  const mayBe = `${named} may be in ${context.namespace}.`;
  // What the way left in the cluster, as far as the step it ended at says it.
  const left = created ? ` ${stays}` : before ? ` ${none}` : "";
  const say = (retry: boolean, text: string) => failure(code, stage, retry, text);

  if (context.plugin)
    return say(
      true,
      `${pluginWords(context.plugin.command, context.plugin.reason, context.plugin.seconds)}${created ? ` ${stays}` : ""}`,
    );
  switch (code) {
    case "validation":
      // The request of the views that is not one of the contract.
      if (stage === "request") return say(false, "The request is not one the main process understands.");
      if (stage === "certificate")
        return say(
          false,
          `What the storage location says of its certificate is not something the extension can use, and no connection is made without verification. ${none}`,
        );
      // What the adapter refuses to send: nothing of it reached the cluster, at the creation either.
      return say(
        false,
        `The request could not be written for the cluster: a name, or the credential it would carry, is not one that can be sent.${stage === "creation" ? ` ${none}` : left}`,
      );
    case "cancelled":
      if (stage === "creation") return say(true, `The request was cancelled while it was created: ${mayBe}`);
      if (created) return say(true, `The download was cancelled. ${stays}`);
      return say(
        true,
        before ? "The request was cancelled before anything was created." : "The request was cancelled.",
      );
    case "deadline":
      // The two minutes of the whole operation, wherever it was when they ended.
      if (context.verdict === "whole")
        return say(
          true,
          stage === "creation"
            ? `The operation did not end in two minutes, and was stopped while the request was created: ${mayBe}`
            : `The operation did not end in two minutes, and was stopped.${left}`,
        );
      if (context.verdict === "unsigned")
        return say(
          true,
          `Velero did not sign a URL in thirty seconds: its server may be stopped or busy, or it could not open the storage location. ${stays}`,
        );
      if (context.verdict === "expired")
        return say(
          true,
          `${request} says that it expired already, and a URL of it would not be good: the clock of this machine and the one of the cluster may not agree. ${stays}`,
        );
      if (stage === "route") return say(true, `The route to the store was not opened in time. ${stays}`);
      if (store) return say(true, `The store did not answer in time. ${stays}`);
      // A creation the cluster did not take in time was not sent: the adapter says a deadline only then.
      return say(true, `${API_WORDS.late}${stage === "creation" ? ` ${none}` : left}`);
    case "artifact-missing":
      return say(
        false,
        `The store has no such file: Velero wrote none for ${target}, or it is not there any more.${left}`,
      );
    case "artifact-invalid":
      return say(
        false,
        `The file of the store is not what Velero writes for this artifact: it could not be read.${left}`,
      );
    case "payload-too-large":
      if (store)
        return say(
          false,
          `The file is larger than the extension loads: 16 MiB as it is stored, 64 MiB of text. Nothing of it is shown. ${stays}`,
        );
      return say(false, `The cluster answered with an object larger than the extension reads.${left}`);
    case "not-found":
      if (stage === "backup")
        return say(
          false,
          `The backup of ${target} is not there: the restore names none, or the one it names is not in ${context.namespace}. Velero signs no URL for such a restore, and no request was created.`,
        );
      if (stage === "location")
        return say(
          false,
          `The storage location of the backup of ${target} is not in ${context.namespace}: Velero signs no URL without it, and no request was created.`,
        );
      if (stage === "certificate")
        return say(
          false,
          `The Secret the storage location names for its certificate is not there, and no connection is made without verification. ${none}`,
        );
      if (stage === "creation")
        return say(
          false,
          `The cluster has no place for a DownloadRequest in ${context.namespace}: the namespace, or the kind of Velero, is not there. ${none}`,
        );
      if (stage === "wait")
        return say(
          true,
          `${request} is not in ${context.namespace} any more: it was removed before Velero signed a URL.`,
        );
      if (stage === "service")
        return say(false, `The Service the URL of the store names is not in the cluster. ${stays}`);
      if (stage === "pod") return say(false, `The Pod of the store is not there any more. ${stays}`);
      if (stage === "route")
        return say(false, `What the route to the store needs in the cluster is not there. ${stays}`);
      if (OF_THE_TARGET.includes(stage))
        return say(false, `${capital(target)} is not in ${context.namespace} any more.${left}`);
      return say(false, `What the request needs in the cluster is not there.${left}`);
    case "target-changed":
      if (context.verdict === "another")
        return say(false, `${request} is not the one that was created: nothing of it is used.`);
      if (context.verdict === "replaced")
        return say(
          false,
          `${capital(target)} is not the one that was confirmed: an object of the same name took its place.${left}`,
        );
      // The connection is looked at again when the cluster has answered: at the creation, after it.
      if (stage === "creation") return say(false, `${API_WORDS.changed} ${capital(mayBe)}`);
      return say(false, `${API_WORDS.changed}${left}`);
    case "forbidden":
      if (stage === "frame") return say(false, "The frame that asked for the write is not there any more.");
      // The cluster did not take the credential: nothing is known of what the identity may do.
      if (context.verdict === "credential")
        return say(
          true,
          `The cluster did not take the credential of the context: it may have expired. Sign in again, then ask again.${stage === "creation" ? ` ${none}` : left}`,
        );
      if (stage === "service" && context.verdict === "candidate")
        return say(
          false,
          `The host of the store may be a Service of the cluster or a name of this machine, and the cluster refused the read that tells which: the identity needs the verb get on services in the namespace the host names, or in the one of the installation when it names none. ${stays}`,
        );
      if (stage === "creation")
        return say(
          false,
          "The cluster refused the creation of a DownloadRequest: the identity needs the verb create on downloadrequests of the namespace.",
        );
      if (stage === "certificate")
        return say(
          false,
          `The cluster refused to read the Secret the storage location names for its certificate: the identity needs the verb get on that Secret, and no connection is made without verification. ${none}`,
        );
      if (stage === "wait") return say(false, `The cluster refused to read the request that was created. ${stays}`);
      if (stage === "backup") return say(false, `The cluster refused to read the backup of ${target}. ${none}`);
      if (stage === "location")
        return say(false, `The cluster refused to read the storage location of the backup of ${target}. ${none}`);
      if (ROUTE_READS[stage])
        return say(
          false,
          `The cluster refused ${ROUTE_READS[stage].refused}: the route through the cluster needs ${ROUTE_READS[stage].needs}. ${stays}`,
        );
      if (stage === "route")
        return say(false, `The cluster refused a read, or the port-forward, the route to the store needs. ${stays}`);
      if (OF_THE_TARGET.includes(stage)) return say(false, `The cluster refused to read ${target}.${left}`);
      return say(false, `The cluster refused what the request needs of it.${left}`);
    case "conflict":
      return say(
        false,
        `${context.request ? `A DownloadRequest named ${context.request}` : "A DownloadRequest of that name"} exists in ${context.namespace} and is not this one: it is kept, and nothing of it is used.`,
      );
    case "submission-unknown":
      return say(
        false,
        `The creation of the request may have happened: the answer of the cluster was lost. Look for ${named} in ${context.namespace} before asking again.`,
      );
    case "tls-invalid":
      if (stage === "certificate")
        return say(
          false,
          `What the storage location gives as its certificate is not a certificate, and no connection is made without verification. ${none}`,
        );
      if (context.verdict === "insecure")
        return say(
          false,
          `${STORE_CERTIFICATE} The storage location asks, with insecureSkipTLSVerify, that the certificate is not verified: the extension verifies it all the same. The storage location can name the certificate of its authority. ${stays}`,
        );
      if (context.verdict === "untrusted") return say(false, `${STORE_CERTIFICATE} ${NAME_THE_AUTHORITY} ${stays}`);
      if (store) return say(false, `${STORE_HANDSHAKE} ${stays}`);
      if (stage === "route") return say(false, `${STORE_UNTRUSTED} ${NAME_THE_AUTHORITY} ${stays}`);
      return say(false, `${API_WORDS.untrusted}${left}`);
    case "destination-denied": {
      const needs = context.needs;

      // What the operator may allow is said with its origin, and carried for the views to offer it.
      if (context.verdict === "allowance" && needs) {
        const asked =
          needs.what === "origin"
            ? `The URL of the request is of ${needs.origin}, which the storage location ${locationWords(needs.location)} does not give: downloads from it are made only after they are allowed for this storage location.`
            : needs.what === "private"
              ? `The store of ${needs.origin} is at a private address: a connection to it is made only after it is allowed.`
              : `The connection to ${needs.origin} would not be encrypted, and would be made directly from this machine: it is made only after it is allowed.`;

        return { ...say(false, `${asked}${left}`), needs };
      }
      const rule = context.verdict ? DENIED[context.verdict] : undefined;

      return say(false, `${rule ?? "The address of the store is not one the extension connects to."}${left}`);
    }
    case "transport-unreachable":
      if (stage === "release")
        return say(
          false,
          `What was opened to reach the store did not close in time. Nothing of the file is shown. ${stays}`,
        );
      if (stage === "route") return say(true, `The route to the store could not be opened. ${stays}`);
      if (store) return say(true, `The store could not be reached. ${stays}`);
      // A creation the cluster was not reached for was not sent: the adapter says so only then.
      return say(true, `${API_WORDS.unreachable}${stage === "creation" ? ` ${none}` : left}`);
    case "request-failed":
      if (context.verdict === "failed")
        return say(false, `Velero could not process the request: it says that it failed. ${stays}`);
      if (store) return say(false, `The store refused the download, with an answer that is not the file. ${stays}`);
      // A creation the cluster answered with a refusal of another kind was not made.
      if (stage === "creation")
        return say(
          false,
          `The cluster did not take the creation of the request, for a reason the extension does not name. ${none}`,
        );
      return say(false, `${API_WORDS.unnamed}${left}`);
    default:
      return say(false, `${API_WORDS.unnamed}${left}`);
  }
}

function capital(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
