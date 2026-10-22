import { describe, expect, it } from "vitest";
import { clusterOfAddress, clusterOfHost, senderKey } from "./frame";

// The identifiers are synthetic, of the form the catalog of the host gives a cluster of a kubeconfig.
const ID = "86a008d2588de4178aa2ac8a245ac1f4";

describe("the cluster of a frame", () => {
  it("reads the identifier of the frames of v2, of the packaged application and of development", () => {
    // The packaged application serves the window from the proxy of Freelens, at `renderer.freelens.app` and the
    // port of the proxy, which Chromium sends to the loopback (packages/core/src/main/start-main-application/
    // lens-window/application-window/create-application-window.injectable.ts line 38, runnables/
    // setup-hostnames.injectable.ts lines 18 to 25 at the validation target), and the frame of a cluster at
    // `//<identifier>.<host of the window>` (common/utils/cluster-id-url-parsing.ts lines 34 to 36).
    expect(clusterOfAddress(`https://${ID}.renderer.freelens.app:45345/`)).toBe(ID);
    expect(
      clusterOfAddress(`https://${ID}.renderer.freelens.app:45345/extension/freelensapp--velero-extension/backups`),
    ).toBe(ID);
    // Development serves them from the loopback, on the port of the server of development.
    expect(clusterOfAddress(`http://${ID}.localhost:9191/`)).toBe(ID);
    expect(clusterOfAddress("http://synthetic-cluster.localhost:9191/extension/freelensapp--velero-extension")).toBe(
      "synthetic-cluster",
    );
  });

  it("reads the host as the host reads it: the port, then the host of the window, taken off", () => {
    expect(clusterOfHost(`${ID}.renderer.freelens.app`)).toBe(ID);
    expect(clusterOfHost(`${ID}.renderer.freelens.app:45345`)).toBe(ID);
    expect(clusterOfHost("synthetic-cluster.localhost:45345")).toBe("synthetic-cluster");
    expect(clusterOfHost("synthetic-cluster.localhost")).toBe("synthetic-cluster");
  });

  it("gives nothing for the window of the host, in the packaged application and in development", () => {
    expect(clusterOfHost("renderer.freelens.app")).toBeUndefined();
    expect(clusterOfHost("renderer.freelens.app:45345")).toBeUndefined();
    expect(clusterOfHost("localhost:9191")).toBeUndefined();
    expect(clusterOfHost("localhost")).toBeUndefined();
    expect(clusterOfAddress("https://renderer.freelens.app:45345/catalog")).toBeUndefined();
    expect(clusterOfAddress("http://localhost:9191/#/catalog")).toBeUndefined();
  });

  it("takes the label the host takes, the one before the host of the window, and not one further up", () => {
    expect(clusterOfHost("one.two.renderer.freelens.app")).toBe("two");
    expect(clusterOfHost("one.two.localhost:9191")).toBe("two");
  });

  it("gives nothing for a host the host never writes for a frame, nor for an empty label", () => {
    expect(clusterOfHost("storage.example.invalid")).toBeUndefined();
    expect(clusterOfHost("freelens.app")).toBeUndefined();
    expect(clusterOfHost(`${ID}.renderer.freelens.app.example.invalid`)).toBeUndefined();
    expect(clusterOfHost(`${ID}.freelens.app`)).toBeUndefined();
    expect(clusterOfHost("")).toBeUndefined();
    expect(clusterOfHost(`${ID}..localhost`)).toBeUndefined();
    expect(clusterOfAddress("https://storage.example.invalid/bucket")).toBeUndefined();
    expect(clusterOfAddress("not an address")).toBeUndefined();
  });

  it("reads a label of another form as the host does, which the contract then refuses where a request names it", () => {
    // The host does not look at the form of what it reads. The identifier a request names is checked by the
    // contract, and a frame is taken for the cluster a request names only when the two are the same: the
    // procedures refuse such a frame (src/main/ipc.test.ts).
    expect(clusterOfHost("_.renderer.freelens.app")).toBe("_");
    expect(clusterOfHost(`${"a".repeat(65)}.localhost`)).toBe("a".repeat(65));
  });

  it("names a sender by its cluster, its process and its frame", () => {
    expect(senderKey("abc123", 5, 4)).toBe("abc123:5:4");
    expect(senderKey("abc123", 5, 4)).not.toBe(senderKey("abc123", 5, 7));
  });
});
