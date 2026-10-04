import { describe, expect, it } from "vitest";
import { downloadFailure, pluginWords } from "./diagnostic-text";
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
    expect(downloadFailure("tls-invalid", "download", created).text).toContain(
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
