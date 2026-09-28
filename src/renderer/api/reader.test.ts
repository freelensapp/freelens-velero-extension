import { beforeEach, describe, expect, it } from "vitest";
import { hostCalls } from "../../../test/freelens-extensions";
import { FAMILIES } from "../../common/discovery";
import { PATHS } from "../../common/paths";
import { readCluster } from "./reader";

beforeEach(() => {
  hostCalls.length = 0;
});

describe("reader of the cluster", () => {
  it("asks with one verb, through the connection of the host", async () => {
    await readCluster(PATHS.discovery);
    await readCluster(PATHS.locations);
    await readCluster(PATHS.family("backups", "velero-demo"));
    expect(hostCalls.filter((call) => !call.startsWith("KubeApi "))).toEqual([
      "GET /apis/velero.io/v1",
      "GET /apis/velero.io/v1/backupstoragelocations",
      "GET /apis/velero.io/v1/namespaces/velero-demo/backups",
    ]);
  });

  it("takes the connection once, from an API of the host it creates when it first reads", async () => {
    await readCluster(PATHS.discovery);
    await readCluster(PATHS.discovery);
    expect(hostCalls.filter((call) => call.startsWith("KubeApi ")).length).toBeLessThanOrEqual(1);
  });

  it("gives the status of the answer, and no body where the answer is not one", async () => {
    expect(await readCluster(PATHS.discovery)).toEqual({ status: 404 });
  });

  it("is given the paths of the kinds of Velero, and asks no other", async () => {
    // Every path the views have is under the group of Velero: none leads to a Secret.
    const paths = [PATHS.discovery, PATHS.locations, ...FAMILIES.map((family) => PATHS.family(family, "velero-demo"))];

    for (const path of paths) {
      expect(path.startsWith("/apis/velero.io/")).toBe(true);
      expect(path).not.toMatch(/secret/i);
    }
    // What is not one of them is not asked of the host, whoever gives it to the reader.
    for (const path of [
      "/api/v1/namespaces/velero-demo/secrets",
      "/api/v1/namespaces/velero-demo/secrets/cloud-credentials",
      "/api/v1/secrets",
      "/apis/velero.io/v1/../../../api/v1/secrets",
      // The same, written as an address writes what is not a letter.
      "/apis/velero.io/v1/%2e%2e/%2e%2e/%2e%2e/api/v1/secrets",
      "/apis/velero.io/v1/.%2e/secrets",
      "/apis/velero.io/v1/.\t./secrets",
      "/apis/velero.io/v1/backups?watch=true",
      "/apis/velero.io/v1/namespaces/velero-demo/backups/one/status",
      "/apis/velero.io/v1/namespaces/Velero/backups",
      "/apis/velero.io/v2/backups",
      "/apis/velero.io.example/v1/backups",
      "/apis/apps/v1/deployments",
      "apis/velero.io/v1/backups",
      " /apis/velero.io/v1/backups",
      "/apis/velero.io/v1/backups\n",
      "",
    ]) {
      expect(await readCluster(path)).toEqual({});
    }
    expect(hostCalls.filter((call) => !call.startsWith("KubeApi "))).toEqual([]);
  });

  it("does not make a path of what is not the name of a namespace", () => {
    for (const name of ["", "Velero", "../velero", "velero/backups", "velero?watch=true"]) {
      expect(() => PATHS.family("backups", name)).toThrow("Not the name of a namespace");
    }
  });
});
