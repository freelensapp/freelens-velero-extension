import { describe, expect, it } from "vitest";
import {
  ALLOWANCES_BOUND,
  type Allowances,
  isAllowed,
  isOrigin,
  readAllowances,
  withAllowance,
  withoutAllowance,
} from "./allowances";

const ORIGIN = "https://storage.example:9000";

describe("what the operator allowed the downloads to do", () => {
  it("takes an origin as the runtime writes it, and nothing with a path, a query, a user or another scheme", () => {
    for (const origin of ["https://storage.example", "http://minio.storage.svc:9000", "https://[2001:db8::1]:8443"])
      expect([origin, isOrigin(origin)]).toEqual([origin, true]);
    for (const other of [
      "https://storage.example/",
      "https://storage.example/bucket",
      "https://storage.example?X-Amz-Signature=synthetic",
      "https://user@storage.example",
      "https://storage.example#",
      // What the runtime would write another way is not an origin as it is kept.
      "https://Storage.example",
      "https://storage.example:443",
      "http://storage.example:80",
      "ftp://storage.example",
      "storage.example",
      "https://",
      `https://${"a".repeat(300)}.example`,
      "",
      7,
      undefined,
    ])
      expect([other, isOrigin(other)]).toEqual([other, false]);
  });

  it("allows nothing that was not given: for that cluster, that origin, that kind, and that location for an origin", () => {
    let allowances: Allowances = {};

    expect(isAllowed(allowances, "cluster-a", "origin", ORIGIN, "velero/default")).toBe(false);
    allowances = withAllowance(
      allowances,
      "cluster-a",
      { what: "origin", origin: ORIGIN, location: "velero/default" },
      1000,
    );
    expect(allowances).toEqual({
      "cluster-a": [{ what: "origin", origin: ORIGIN, location: "velero/default", since: 1000 }],
    });
    expect(isAllowed(allowances, "cluster-a", "origin", ORIGIN, "velero/default")).toBe(true);
    // Another cluster, another origin, another location, another kind: none of them was allowed.
    expect(isAllowed(allowances, "cluster-b", "origin", ORIGIN, "velero/default")).toBe(false);
    expect(isAllowed(allowances, "cluster-a", "origin", "https://storage.example", "velero/default")).toBe(false);
    expect(isAllowed(allowances, "cluster-a", "origin", ORIGIN, "velero/secondary")).toBe(false);
    // A location of the same name in another namespace is another location.
    expect(isAllowed(allowances, "cluster-a", "origin", ORIGIN, "velero-b/default")).toBe(false);
    expect(isAllowed(allowances, "cluster-a", "origin", ORIGIN)).toBe(false);
    expect(isAllowed(allowances, "cluster-a", "private", ORIGIN)).toBe(false);
    expect(isAllowed(allowances, "cluster-a", "http", ORIGIN)).toBe(false);
    // A private address and plain HTTP are of the origin alone, whatever location is asked about.
    allowances = withAllowance(allowances, "cluster-a", { what: "private", origin: ORIGIN }, 2000);
    allowances = withAllowance(allowances, "cluster-a", { what: "http", origin: "http://storage.example" }, 3000);
    expect(isAllowed(allowances, "cluster-a", "private", ORIGIN)).toBe(true);
    expect(isAllowed(allowances, "cluster-a", "private", ORIGIN, "any")).toBe(true);
    expect(isAllowed(allowances, "cluster-a", "http", "http://storage.example")).toBe(true);
    expect(isAllowed(allowances, "cluster-a", "http", ORIGIN)).toBe(false);
    expect(allowances["cluster-a"]).toHaveLength(3);
  });

  it("keeps the time of an allowance that is given again, and what it holds is the origin and nothing after it", () => {
    const first = withAllowance({}, "cluster-a", { what: "private", origin: ORIGIN }, 1000);

    expect(withAllowance(first, "cluster-a", { what: "private", origin: ORIGIN }, 9000)).toBe(first);
    // A location is of an origin that is allowed, and of no other kind.
    expect(withAllowance({}, "cluster-a", { what: "private", origin: ORIGIN, location: "velero/default" }, 1)).toEqual({
      "cluster-a": [{ what: "private", origin: ORIGIN, since: 1 }],
    });
    // What is not well formed is not kept: a URL, an origin without its location, no cluster.
    for (const given of [
      { what: "origin", origin: `${ORIGIN}/bucket/key?X-Amz-Signature=synthetic`, location: "velero/default" },
      { what: "origin", origin: ORIGIN },
      { what: "origin", origin: ORIGIN, location: "Not A Name" },
      { what: "everything", origin: ORIGIN },
    ] as const)
      expect([given, withAllowance({}, "cluster-a", given as never, 1)]).toEqual([given, {}]);
    expect(withAllowance({}, "", { what: "http", origin: ORIGIN }, 1)).toEqual({});
    expect(withAllowance({}, "cluster-a", { what: "http", origin: ORIGIN }, -1)).toEqual({});
  });

  it("takes an allowance back, and leaves the others and the other clusters as they are", () => {
    let allowances = withAllowance({}, "cluster-a", { what: "origin", origin: ORIGIN, location: "velero/default" }, 1);

    allowances = withAllowance(allowances, "cluster-a", { what: "private", origin: ORIGIN }, 2);
    allowances = withAllowance(allowances, "cluster-b", { what: "private", origin: ORIGIN }, 3);
    const taken = withoutAllowance(allowances, "cluster-a", {
      what: "origin",
      origin: ORIGIN,
      location: "velero/default",
    });

    expect(taken).toEqual({
      "cluster-a": [{ what: "private", origin: ORIGIN, since: 2 }],
      "cluster-b": [{ what: "private", origin: ORIGIN, since: 3 }],
    });
    expect(isAllowed(taken, "cluster-a", "origin", ORIGIN, "default")).toBe(false);
    // The last of a cluster leaves no entry of the cluster; one that is not there changes nothing.
    expect(withoutAllowance(taken, "cluster-a", { what: "private", origin: ORIGIN })).toEqual({
      "cluster-b": [{ what: "private", origin: ORIGIN, since: 3 }],
    });
    expect(withoutAllowance(taken, "cluster-a", { what: "http", origin: ORIGIN })).toEqual(taken);
    expect(withoutAllowance(taken, "cluster-c", { what: "http", origin: ORIGIN })).toEqual(taken);
  });

  it("bounds what a cluster keeps", () => {
    let allowances: Allowances = {};

    for (let index = 0; index < ALLOWANCES_BOUND + 5; index += 1)
      allowances = withAllowance(
        allowances,
        "cluster-a",
        { what: "private", origin: `https://s${index}.example` },
        index,
      );
    expect(allowances["cluster-a"]).toHaveLength(ALLOWANCES_BOUND);
    expect(isAllowed(allowances, "cluster-a", "private", `https://s${ALLOWANCES_BOUND}.example`)).toBe(false);
  });

  it("reads what a store holds with no trust in its form, and leaves out what is not an allowance", () => {
    const stored = {
      "cluster-a": [
        { what: "origin", origin: ORIGIN, location: "velero/default", since: 1000 },
        { what: "private", origin: ORIGIN, since: 2000 },
        // The same one twice is one.
        { what: "private", origin: ORIGIN, since: 5000 },
        // What is not one: a URL, a field more, a credential, a kind that is none, no time.
        { what: "http", origin: `${ORIGIN}/bucket?X-Amz-Signature=synthetic`, since: 1 },
        { what: "http", origin: ORIGIN, since: 1, token: "synthetic" },
        { what: "http", origin: ORIGIN, since: 1, location: "velero/default" },
        { what: "all", origin: ORIGIN, since: 1 },
        { what: "http", origin: ORIGIN },
        { what: "origin", origin: ORIGIN, since: 1 },
        "https://storage.example",
        null,
      ],
      "cluster-b": "everything",
      "cluster-c": [],
      "": [{ what: "private", origin: ORIGIN, since: 1 }],
      // A location is a namespace and a name: a name alone, which two installations of a cluster may
      // share, is not one, and neither is what has more parts or capitals.
      "cluster-d": [
        { what: "origin", origin: ORIGIN, location: "default", since: 1 },
        { what: "origin", origin: ORIGIN, location: "velero/default/more", since: 1 },
        { what: "origin", origin: ORIGIN, location: "Velero/default", since: 1 },
        { what: "origin", origin: ORIGIN, location: "/default", since: 1 },
        { what: "origin", origin: ORIGIN, location: "velero/", since: 1 },
      ],
    };

    expect(readAllowances(stored)).toEqual({
      "cluster-a": [
        { what: "origin", origin: ORIGIN, location: "velero/default", since: 1000 },
        { what: "private", origin: ORIGIN, since: 2000 },
      ],
    });
    for (const other of [undefined, null, "allowances", 7, []]) expect(readAllowances(other)).toEqual({});
    // A key every object has is not the identifier of a cluster: what is read under it is left out, and
    // what is answered is an object as any other.
    const odd = readAllowances(JSON.parse(`{"__proto__":[{"what":"private","origin":"${ORIGIN}","since":1}]}`));

    expect(odd).toEqual({});
    expect(Object.getPrototypeOf(odd)).toBe(Object.prototype);
    expect(withAllowance({}, "__proto__", { what: "private", origin: ORIGIN }, 1)).toEqual({});
    // The same origin allowed for a location of another installation of the cluster is another allowance.
    const two = withAllowance(
      withAllowance({}, "cluster-a", { what: "origin", origin: ORIGIN, location: "velero/default" }, 1),
      "cluster-a",
      { what: "origin", origin: ORIGIN, location: "velero-b/default" },
      2,
    );

    expect(two["cluster-a"]).toHaveLength(2);
    expect(isAllowed(two, "cluster-a", "origin", ORIGIN, "velero-b/default")).toBe(true);
    expect(isAllowed(two, "cluster-a", "origin", ORIGIN, "velero-c/default")).toBe(false);
    // No more than a cluster may keep is read of it.
    const many = Array.from({ length: ALLOWANCES_BOUND + 9 }, (_, index) => ({
      what: "private",
      origin: `https://s${index}.example`,
      since: index,
    }));

    expect(readAllowances({ "cluster-a": many })["cluster-a"]).toHaveLength(ALLOWANCES_BOUND);
  });
});
