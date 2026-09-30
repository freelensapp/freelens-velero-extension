import { describe, expect, it } from "vitest";
import { clusterOfAddress, clusterOfHost, senderKey } from "./frame";

describe("the cluster of a frame", () => {
  it("reads the identifier before the host of the packaged application and of development", () => {
    expect(clusterOfHost("86a008d2588de4178aa2ac8a245ac1f4.renderer.freelens.app:45345")).toBe(
      "86a008d2588de4178aa2ac8a245ac1f4",
    );
    expect(clusterOfHost("synthetic-cluster.localhost:45345")).toBe("synthetic-cluster");
    expect(clusterOfHost("synthetic-cluster.localhost")).toBe("synthetic-cluster");
  });

  it("gives nothing for the window of the host and for a host that is not one of its", () => {
    expect(clusterOfHost("renderer.freelens.app:45345")).toBeUndefined();
    expect(clusterOfHost("localhost:45345")).toBeUndefined();
    expect(clusterOfHost("storage.example.invalid")).toBeUndefined();
    expect(clusterOfHost("")).toBeUndefined();
  });

  it("takes the label before the host and not one further up", () => {
    expect(clusterOfHost("one.two.renderer.freelens.app")).toBe("two");
  });

  it("refuses an identifier that is not written as the host writes one", () => {
    expect(clusterOfHost("_.renderer.freelens.app")).toBeUndefined();
    expect(clusterOfHost(`${"a".repeat(65)}.localhost`)).toBeUndefined();
  });

  it("reads the whole address, and gives nothing for what is not one", () => {
    expect(clusterOfAddress("https://abc123.renderer.freelens.app:45345/cluster/overview")).toBe("abc123");
    expect(clusterOfAddress("https://renderer.freelens.app:45345/catalog")).toBeUndefined();
    expect(clusterOfAddress("not an address")).toBeUndefined();
  });

  it("names a sender by its cluster, its process and its frame", () => {
    expect(senderKey("abc123", 5, 4)).toBe("abc123:5:4");
    expect(senderKey("abc123", 5, 4)).not.toBe(senderKey("abc123", 5, 7));
  });
});
