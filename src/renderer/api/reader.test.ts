import { beforeEach, describe, expect, it } from "vitest";
import { hostCalls } from "../../../test/freelens-extensions";
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

  it("does not make a path of what is not the name of a namespace", () => {
    for (const name of ["", "Velero", "../velero", "velero/backups", "velero?watch=true"]) {
      expect(() => PATHS.family("backups", name)).toThrow("Not the name of a namespace");
    }
  });
});
