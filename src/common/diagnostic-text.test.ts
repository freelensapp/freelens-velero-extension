import { describe, expect, it } from "vitest";
import { createdNothing, downloadFailure, pluginWords } from "./diagnostic-text";
import { DOWNLOAD_STAGES, type FailureCode, readAnswer } from "./ipc";

// Every code a DownloadRequest can end with.
const CODES: FailureCode[] = [
  "validation",
  "forbidden",
  "not-found",
  "conflict",
  "cancelled",
  "deadline",
  "submission-unknown",
  "artifact-missing",
  "artifact-invalid",
  "transport-unreachable",
  "tls-invalid",
  "destination-denied",
  "payload-too-large",
  "request-failed",
  "target-changed",
];
const context = { artifact: "BackupLog", name: "nightly", namespace: "velero-a" } as const;
const created = { ...context, request: "nightly-0e7c5b7a-1111-4111-8111-000000000001" };

describe("the words of a DownloadRequest that did not end with its file", () => {
  it("gives every code at every step an answer of the contract, with its code and its step", () => {
    for (const code of CODES) {
      for (const stage of DOWNLOAD_STAGES) {
        for (const given of [context, created]) {
          const said = downloadFailure(code, stage, given);

          expect(said).toMatchObject({ ok: false, code, stage });
          // What the views read as a failure is what was said: it is within the contract.
          expect([code, stage, readAnswer(said, () => undefined)]).toEqual([code, stage, said]);
          expect([code, stage, /undefined|null|\[object|https?:|\?|=/.test(said.text)]).toEqual([code, stage, false]);
          expect(said.text).toMatch(/[.]$/);
        }
      }
    }
  });

  it("folds no two codes into one at any step: each way of ending has words of its own", () => {
    for (const stage of DOWNLOAD_STAGES) {
      const words = CODES.map((code) => downloadFailure(code, stage, created).text);

      expect([stage, new Set(words).size]).toEqual([stage, CODES.length]);
    }
  });

  it("tells a file the store does not have from a store that was not reached and from a URL that was not signed", () => {
    expect(downloadFailure("artifact-missing", "download", created).text).toBe(
      "The store has no such file: Velero wrote none for the backup nightly, or it is not there any more. The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.",
    );
    expect(downloadFailure("transport-unreachable", "download", created).text).toContain(
      "The store could not be reached.",
    );
    expect(downloadFailure("tls-invalid", "download", { ...created, verdict: "untrusted" }).text).toContain(
      "The certificate of the store is not trusted.",
    );
    const unsigned = downloadFailure("deadline", "wait", { ...created, verdict: "unsigned" });

    expect(unsigned.text).toBe(
      "Velero did not sign a URL in thirty seconds: its server may be stopped or busy, or it could not open the storage location. The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.",
    );
    // Not signed is not a claim that the server is down.
    expect(unsigned.text).not.toMatch(/\b(down|dead|broken|crashed)\b/i);
  });

  it("says of Velero only what the request said: a read the cluster did not answer is said of the cluster", () => {
    const stays =
      "The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.";
    const at = (code: FailureCode, verdict?: "unsigned" | "failed" | "expired" | "another") =>
      downloadFailure(code, "wait", verdict ? { ...created, verdict } : created);

    // The same code at the same step, said two ways: what the request said, and what a read of it ended with.
    expect(at("deadline").text).toBe(`The cluster did not answer in time. ${stays}`);
    // Asking again is a new request: it is safe, and the one that waited stays.
    expect(at("deadline", "unsigned")).toMatchObject({
      retry: true,
      text: expect.stringContaining("Velero did not sign a URL in thirty seconds"),
    });
    expect(at("deadline", "expired")).toMatchObject({
      retry: true,
      text: `The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 says that it expired already, and a URL of it would not be good: the clock of this machine and the one of the cluster may not agree. ${stays}`,
    });
    expect(at("request-failed").text).toBe(
      `The request could not be made, for a reason the extension does not name. ${stays}`,
    );
    expect(at("request-failed", "failed")).toMatchObject({
      retry: false,
      text: `Velero could not process the request: it says that it failed. ${stays}`,
    });
    expect(at("target-changed").text).toBe(
      `The cluster or the installation changed while the request was made. ${stays}`,
    );
    expect(at("target-changed", "another").text).toBe(
      "The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 is not the one that was created: nothing of it is used.",
    );
    // Without a verdict nothing is said of Velero, at any step.
    for (const stage of DOWNLOAD_STAGES)
      for (const code of ["deadline", "request-failed", "target-changed"] as const)
        expect([code, stage, /Velero (did not|could not)/.test(downloadFailure(code, stage, created).text)]).toEqual([
          code,
          stage,
          false,
        ]);
    // A target that an object of the same name took the place of, before and after the creation.
    expect(downloadFailure("target-changed", "target", { ...context, verdict: "replaced" }).text).toBe(
      "The backup nightly is not the one that was confirmed: an object of the same name took its place. No request was created.",
    );
    expect(downloadFailure("target-changed", "delivery", { ...created, verdict: "replaced" }).text).toBe(
      `The backup nightly is not the one that was confirmed: an object of the same name took its place. ${stays}`,
    );
  });

  it("says that the certificate is verified whatever the storage location asks", () => {
    const said = downloadFailure("tls-invalid", "download", { ...created, verdict: "insecure" });

    expect(said).toMatchObject({ code: "tls-invalid", stage: "download", retry: false });
    expect(said.text).toBe(
      "The certificate of the store is not trusted. The storage location asks, with insecureSkipTLSVerify, that the certificate is not verified: the extension verifies it all the same. The storage location can name the certificate of its authority. The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.",
    );
    // Without that key the words say only how to give the certificate.
    expect(downloadFailure("tls-invalid", "download", { ...created, verdict: "untrusted" }).text).toBe(
      "The certificate of the store is not trusted. The storage location can name the certificate of its authority; the verification is never turned off. The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.",
    );
  });

  it("tells a handshake of TLS that failed from a certificate that was refused, and says of neither what it does not know", () => {
    const stays =
      "The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.";
    const handshake = downloadFailure("tls-invalid", "download", created);

    // No certificate was refused: the words do not send the operator to the certificate of the location.
    expect(handshake).toMatchObject({ code: "tls-invalid", stage: "download", retry: false });
    expect(handshake.text).toBe(
      `The handshake of TLS with the store failed, and no certificate was refused: the store may not speak TLS at the port of its URL, or a version of it the extension does not, or the connection was closed while it was made. ${stays}`,
    );
    expect(handshake.text).not.toMatch(/authority|insecureSkipTLSVerify/);
    // At the step of the route it is not known which of the two it was.
    expect(downloadFailure("tls-invalid", "route", created).text).toBe(
      `The connection to the store was not trusted: its certificate was refused, or the handshake of TLS failed. The storage location can name the certificate of its authority; the verification is never turned off. ${stays}`,
    );
    // What a location asks is said of a certificate that was refused, and only there.
    expect(downloadFailure("tls-invalid", "route", { ...created, verdict: "untrusted" }).text).toContain(
      "The certificate of the store is not trusted. The storage location can name",
    );
  });

  it("says the rule that denies a destination, each in words of its own", () => {
    const stays =
      "The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.";
    const denied = (verdict: "url" | "public-url" | "path" | "ambiguous" | "port" | "endpoint" | "address") =>
      downloadFailure("destination-denied", "route", { ...created, verdict });

    expect(denied("url")).toEqual({
      ok: false,
      code: "destination-denied",
      stage: "route",
      retry: false,
      text: `The URL of the request is not one the extension takes: it is not of HTTP or HTTPS, or it carries a user or a fragment. ${stays}`,
    });
    expect(denied("public-url").text).toBe(
      `The storage location signs over its public URL, and the URL of the request is of the URL of its store: it is not one Velero signed for this location. ${stays}`,
    );
    expect(denied("path").text).toBe(
      `The URL of the request is not of the file that was asked: its path is not the one of this artifact in the bucket of the storage location. Nothing was fetched. ${stays}`,
    );
    expect(denied("ambiguous").text).toBe(
      `The host of the store is a Service of the cluster and a name this machine resolves as well: it is not known which of the two Velero signed for. ${stays}`,
    );
    expect(denied("port").text).toBe(
      `The port of the URL is not one the Service of the store has, or its Pod does not declare the port the Service sends it to. ${stays}`,
    );
    expect(denied("endpoint").text).toBe(
      `The Service of the store has no Pod that is ready, among the ones it selects, to send the request to. ${stays}`,
    );
    expect(denied("address").text).toBe(
      `The name of the store gives no address the extension connects to: an address of this machine, of the link or of a metadata service is never one. ${stays}`,
    );
    // Seven rules, seven sentences, and none is the one of a destination denied for a reason that is not said.
    const all = (["url", "public-url", "path", "ambiguous", "port", "endpoint", "address"] as const).map(
      (verdict) => denied(verdict).text,
    );

    expect(new Set([...all, downloadFailure("destination-denied", "route", created).text]).size).toBe(8);
  });

  it("says what the operator may allow, with the origin and nothing after it, and carries it for the views", () => {
    const stays =
      "The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.";
    const origin = "https://storage.example:9000";
    const asked = (needs: { what: "origin" | "private" | "http"; origin: string; location?: string }) =>
      downloadFailure("destination-denied", "route", { ...created, verdict: "allowance", needs });

    expect(asked({ what: "origin", origin, location: "velero/default" })).toEqual({
      ok: false,
      code: "destination-denied",
      stage: "route",
      retry: false,
      text: `The URL of the request is of ${origin}, which the storage location default of velero does not give: downloads from it are made only after they are allowed for this storage location. ${stays}`,
      needs: { what: "origin", origin, location: "velero/default" },
    });
    expect(asked({ what: "private", origin })).toMatchObject({
      text: `The store of ${origin} is at a private address: a connection to it is made only after it is allowed. ${stays}`,
      needs: { what: "private", origin },
    });
    expect(asked({ what: "http", origin: "http://storage.example" })).toMatchObject({
      text: `The connection to http://storage.example would not be encrypted, and would be made directly from this machine: it is made only after it is allowed. ${stays}`,
      needs: { what: "http", origin: "http://storage.example" },
    });
    // What the views read of it is of the contract.
    const said = asked({ what: "private", origin });

    expect(readAnswer(said, () => undefined)).toEqual(said);
    // Nothing else of a failure carries what may be allowed.
    expect("needs" in downloadFailure("destination-denied", "route", created)).toBe(false);
  });

  it("says which read of the route the cluster refused, and what the route through the cluster needs", () => {
    const stays =
      "The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.";

    expect(downloadFailure("forbidden", "service", created).text).toBe(
      `The cluster refused to read the Service of the store: the route through the cluster needs the verb get on services. ${stays}`,
    );
    expect(downloadFailure("forbidden", "endpoints", created).text).toBe(
      `The cluster refused to list the endpoint slices of the Service of the store: the route through the cluster needs the verb list on endpointslices. ${stays}`,
    );
    expect(downloadFailure("forbidden", "pod", created).text).toBe(
      `The cluster refused to read the Pod of the store: the route through the cluster needs the verb get on pods. ${stays}`,
    );
    // A port-forward over a WebSocket is asked with the verb get, and the releases that check the verb
    // create as well ask for both: the words name both.
    expect(downloadFailure("forbidden", "forward", created).text).toBe(
      `The cluster refused the port-forward to the Pod of the store: the route through the cluster needs the verbs get and create on pods/portforward. ${stays}`,
    );
    // A name that only may be a Service, which the cluster refused to say: the words do not call it one.
    expect(downloadFailure("forbidden", "service", { ...created, verdict: "candidate" }).text).toBe(
      `The host of the store may be a Service of the cluster or a name of this machine, and the cluster refused the read that tells which: the identity needs the verb get on services in the namespace the host names, or in the one of the installation when it names none. ${stays}`,
    );
    // A credential the cluster did not take is not a permission the identity lacks, at any step.
    for (const stage of ["target", "location", "certificate", "creation", "wait", "service", "pod", "forward"]) {
      const said = downloadFailure("forbidden", stage, { ...created, verdict: "credential" });

      expect([
        stage,
        said.retry,
        said.text.startsWith("The cluster did not take the credential of the context"),
      ]).toEqual([stage, true, true]);
      expect(said.text).not.toMatch(/needs the verb|refused/);
    }
    expect(downloadFailure("forbidden", "forward", { ...created, verdict: "credential" }).text).toBe(
      `The cluster did not take the credential of the context: it may have expired. Sign in again, then ask again. ${stays}`,
    );
    expect(downloadFailure("forbidden", "creation", { ...created, verdict: "credential" }).text).toBe(
      "The cluster did not take the credential of the context: it may have expired. Sign in again, then ask again. No request was created.",
    );
    expect(downloadFailure("not-found", "service", created).text).toBe(
      `The Service the URL of the store names is not in the cluster. ${stays}`,
    );
    expect(downloadFailure("not-found", "pod", created).text).toBe(
      `The Pod of the store is not there any more. ${stays}`,
    );
    // Every step of the route is after the creation: the request stays, and is said to.
    for (const stage of ["service", "endpoints", "pod", "forward"]) {
      for (const code of CODES)
        expect([stage, code, downloadFailure(code, stage, created).text.includes("No request was created")]).toEqual([
          stage,
          code,
          false,
        ]);
      for (const code of ["cancelled", "deadline", "transport-unreachable", "target-changed", "forbidden"] as const)
        expect([stage, code, downloadFailure(code, stage, created).text.endsWith(stays)]).toEqual([stage, code, true]);
    }
  });

  it("claims nothing of what was left at a step it does not know, and says of each step what was asked at it", () => {
    for (const code of CODES) {
      const said = downloadFailure(code, "a-step-of-a-later-slice", created).text;

      // The codes whose words are of the request itself say what they know of it at any step.
      if (code === "conflict" || code === "submission-unknown") continue;
      expect([code, /No request was created|stays in|Nothing was created|before anything/.test(said)]).toEqual([
        code,
        false,
      ]);
    }
    // The route is of the cluster and of the store: what ends at it is not said of the target.
    for (const code of ["not-found", "forbidden", "deadline", "transport-unreachable"] as const) {
      const said = downloadFailure(code, "route", created).text;

      expect([code, said.includes("route to the store"), said.includes("the backup nightly")]).toEqual([
        code,
        true,
        false,
      ]);
    }
    // An object of the cluster that is too large is not a file of the store that is.
    expect(downloadFailure("payload-too-large", "location", context).text).toBe(
      "The cluster answered with an object larger than the extension reads. No request was created.",
    );
    // What the adapter cannot send is not a request the main process does not understand.
    expect(downloadFailure("validation", "request", context).text).toBe(
      "The request is not one the main process understands.",
    );
    expect(downloadFailure("validation", "creation", context).text).toBe(
      "The request could not be written for the cluster: a name, or the credential it would carry, is not one that can be sent. No request was created.",
    );
    expect(downloadFailure("validation", "certificate", context).text).toContain(
      "What the storage location says of its certificate is not something the extension can use",
    );
    // A creation the cluster refused in a way that is not named was not made.
    expect(downloadFailure("request-failed", "creation", context).text).toBe(
      "The cluster did not take the creation of the request, for a reason the extension does not name. No request was created.",
    );
  });

  it("says which object is not there, and that no request was created before the creation", () => {
    expect(downloadFailure("not-found", "target", context).text).toBe(
      "The backup nightly is not in velero-a any more. No request was created.",
    );
    expect(downloadFailure("not-found", "backup", { ...context, artifact: "RestoreLog" }).text).toBe(
      "The backup of the restore nightly is not there: the restore names none, or the one it names is not in velero-a. Velero signs no URL for such a restore, and no request was created.",
    );
    expect(downloadFailure("not-found", "location", context).text).toBe(
      "The storage location of the backup of the backup nightly is not in velero-a: Velero signs no URL without it, and no request was created.",
    );
    expect(downloadFailure("not-found", "wait", created).text).toContain("was removed before Velero signed a URL");
  });

  it("says which read or creation the cluster refused, and what the identity needs for the ones it can be given", () => {
    expect(downloadFailure("forbidden", "creation", context).text).toBe(
      "The cluster refused the creation of a DownloadRequest: the identity needs the verb create on downloadrequests of the namespace.",
    );
    expect(downloadFailure("forbidden", "certificate", context).text).toContain("the verb get on that Secret");
    expect(downloadFailure("forbidden", "target", context).text).toBe(
      "The cluster refused to read the backup nightly. No request was created.",
    );
    expect(downloadFailure("forbidden", "location", context).text).toContain("the storage location");
    expect(downloadFailure("forbidden", "wait", created).text).toContain("refused to read the request");
  });

  it("names the request for the ways that end after its creation, and says that it stays: none is deleted", () => {
    for (const stage of ["wait", "route", "download", "delivery"] as const) {
      for (const code of ["cancelled", "deadline", "transport-unreachable", "tls-invalid"] as const) {
        const said = downloadFailure(code, stage, created).text;

        expect([code, stage, said.includes(created.request)]).toEqual([code, stage, true]);
        expect([code, stage, said.includes("until Velero removes it")]).toEqual([code, stage, true]);
      }
    }
    for (const stage of ["queue", "target", "backup", "location", "certificate"] as const) {
      expect([stage, downloadFailure("cancelled", stage, context).text]).toEqual([
        stage,
        "The request was cancelled before anything was created.",
      ]);
    }
    // At the creation it is not known.
    expect(downloadFailure("cancelled", "creation", created).text).toBe(
      "The request was cancelled while it was created: the DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 may be in velero-a.",
    );
    expect(downloadFailure("submission-unknown", "creation", created).text).toBe(
      "The creation of the request may have happened: the answer of the cluster was lost. Look for the DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 in velero-a before asking again.",
    );
    expect(downloadFailure("conflict", "creation", created).text).toContain("it is kept, and nothing of it is used");
    // The connection is looked at again after the cluster answered a creation: the request may be there.
    expect(downloadFailure("target-changed", "creation", created).text).toBe(
      "The cluster or the installation changed while the request was made. The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 may be in velero-a.",
    );
    expect(downloadFailure("target-changed", "target", created).text).toBe(
      "The cluster or the installation changed while the request was made. No request was created.",
    );
    // The cluster answers that there is no such place when the creation is asked of it.
    expect(downloadFailure("not-found", "creation", created)).toMatchObject({
      retry: false,
      text: "The cluster has no place for a DownloadRequest in velero-a: the namespace, or the kind of Velero, is not there. No request was created.",
    });
  });

  it("tells the two minutes of the whole operation from the bound of a step, and says what they left", () => {
    const whole = { ...created, verdict: "whole" as const };

    expect(downloadFailure("deadline", "location", whole)).toMatchObject({
      retry: true,
      text: "The operation did not end in two minutes, and was stopped. No request was created.",
    });
    // At the creation it is not known whether the request is there.
    expect(downloadFailure("deadline", "creation", whole).text).toBe(
      "The operation did not end in two minutes, and was stopped while the request was created: the DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 may be in velero-a.",
    );
    // Nothing of thirty seconds is said of a wait that the two minutes ended.
    expect(downloadFailure("deadline", "wait", whole).text).toBe(
      "The operation did not end in two minutes, and was stopped. The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.",
    );
    expect(downloadFailure("deadline", "creation", created).text).toBe(
      "The cluster did not answer in time. No request was created.",
    );
    // Only a deadline is of the whole operation.
    expect(downloadFailure("cancelled", "wait", whole).text).toBe(downloadFailure("cancelled", "wait", created).text);
  });

  it("says a plugin of the context that gave no credential by its command, and not as a refusal of the cluster", () => {
    for (const reason of ["failed", "deadline", "unreadable"] as const) {
      const said = downloadFailure("request-failed", "creation", {
        ...context,
        plugin: { command: "kubelogin", reason, seconds: 30 },
      });

      expect(said).toMatchObject({ code: "request-failed", stage: "creation", retry: true });
      expect(said.text).toBe(pluginWords("kubelogin", reason, 30));
      expect(said.text).not.toMatch(/refused|verb/);
    }
    // After the creation the request is there, and the words say so.
    expect(
      downloadFailure("request-failed", "wait", {
        ...created,
        plugin: { command: "kubelogin", reason: "failed", seconds: 30 },
      }).text,
    ).toContain("stays in velero-a until Velero removes it");
  });

  it("says whether asking again, as it was asked, is safe", () => {
    const retry = (code: FailureCode, stage: string) => downloadFailure(code, stage, created).retry;

    expect(CODES.filter((code) => retry(code, "download"))).toEqual(["cancelled", "deadline", "transport-unreachable"]);
    expect(retry("not-found", "wait")).toBe(true);
    expect(retry("submission-unknown", "creation")).toBe(false);
    // No URL in time: asking again is a new request, and the one that waited stays.
    expect(CODES.filter((code) => retry(code, "wait"))).toEqual([
      "not-found",
      "cancelled",
      "deadline",
      "transport-unreachable",
    ]);
    expect(CODES.filter((code) => retry(code, "creation"))).toEqual(["cancelled", "deadline", "transport-unreachable"]);
  });

  it("knows the steps before the creation, at which a way that ended left no request, and claims it of no other", () => {
    // The steps a way is at before it creates its request: one that ends there created nothing.
    expect(DOWNLOAD_STAGES.filter((stage) => createdNothing(stage))).toEqual([
      "queue",
      "target",
      "backup",
      "location",
      "certificate",
    ]);
    // They are the steps the words of a cancellation say it of.
    for (const stage of DOWNLOAD_STAGES) {
      expect([
        stage,
        downloadFailure("cancelled", stage, context).text.includes("before anything was created"),
      ]).toEqual([stage, createdNothing(stage)]);
    }
    // A step this file does not know is one nothing is claimed of.
    expect(createdNothing("gate")).toBe(false);
    expect(createdNothing("")).toBe(false);
  });

  it("says the bounds of a file that is larger than the extension loads, and that nothing of it is shown", () => {
    expect(downloadFailure("payload-too-large", "download", created)).toEqual({
      ok: false,
      code: "payload-too-large",
      stage: "download",
      retry: false,
      text: "The file is larger than the extension loads: 16 MiB as it is stored, 64 MiB of text. Nothing of it is shown. The DownloadRequest nightly-0e7c5b7a-1111-4111-8111-000000000001 stays in velero-a until Velero removes it.",
    });
  });
});
