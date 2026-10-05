import { describe, expect, it } from "vitest";
import { artifactKey, checkOrigin, hostForm, isArtifactPath } from "./artifact-origin";
import { ARTIFACT_TARGETS } from "./ipc";

const QUERY = "?X-Amz-Signature=synthetic";

describe("the origin of a signed URL, against the ones its storage location gives", () => {
  it("takes the URL of the store of a location of AWS, with the bucket in the path when the plugin is told so", () => {
    const location = {
      provider: "aws",
      bucket: "velero-demo",
      config: { s3Url: "http://seaweedfs.velero-demo.svc:8333", s3ForcePathStyle: "true" },
    };

    expect(
      checkOrigin(`http://seaweedfs.velero-demo.svc:8333/velero-demo/backups/a/a-logs.gz${QUERY}`, location),
    ).toEqual({
      verdict: "known",
      origin: "http://seaweedfs.velero-demo.svc:8333",
      bucket: "path",
    });
    // The bucket as a label of the host is how the SDK addresses it when the path is not forced: forced,
    // it is an origin the location does not give.
    expect(
      checkOrigin(`http://velero-demo.seaweedfs.velero-demo.svc:8333/backups/a/a-logs.gz${QUERY}`, location),
    ).toEqual({ verdict: "allowance", origin: "http://velero-demo.seaweedfs.velero-demo.svc:8333" });
  });

  it("takes the bucket as a label of the host when the path is not forced, with the same scheme and port", () => {
    for (const forced of [undefined, "false", "0", "no", ""]) {
      const location = {
        provider: "velero.io/aws",
        bucket: "Backups-Of-Prod".toLowerCase(),
        config: {
          s3Url: "https://S3.Storage.example:9000",
          ...(forced === undefined ? {} : { s3ForcePathStyle: forced }),
        },
      };

      expect([
        forced,
        checkOrigin(`https://backups-of-prod.s3.storage.example:9000/backups/a/a-logs.gz${QUERY}`, location),
      ]).toEqual([
        forced,
        { verdict: "known", origin: "https://backups-of-prod.s3.storage.example:9000", bucket: "host" },
      ]);
      // The same origin as the store is the path style the SDK falls back to.
      expect(
        checkOrigin(`https://s3.storage.example:9000/backups-of-prod/backups/a/a-logs.gz${QUERY}`, location),
      ).toEqual({
        verdict: "known",
        origin: "https://s3.storage.example:9000",
        bucket: "path",
      });
      // Another scheme, another port, another bucket: none is the origin of the location.
      for (const other of [
        "http://backups-of-prod.s3.storage.example:9000/x",
        "https://backups-of-prod.s3.storage.example:9001/x",
        "https://backups-of-prod.s3.storage.example/x",
        "https://another.s3.storage.example:9000/x",
        "https://backups-of-prod.s3.storage.example.attacker.example:9000/x",
        "https://xbackups-of-prod.s3.storage.example:9000/x",
      ])
        expect([other, checkOrigin(other, location).verdict]).toEqual([other, "allowance"]);
    }
    // Every text the plugin reads as true forces the path.
    for (const forced of ["1", "t", "T", "TRUE", "true", "True"])
      expect([
        forced,
        checkOrigin("https://bucket.s3.storage.example/backups/a/a-logs.gz", {
          provider: "aws",
          bucket: "bucket",
          config: { s3Url: "https://s3.storage.example", s3ForcePathStyle: forced },
        }).verdict,
      ]).toEqual([forced, "allowance"]);
  });

  it("signs over the public URL when the location has one, and refuses the URL of the store then", () => {
    const location = {
      provider: "aws",
      bucket: "bucket",
      config: { s3Url: "http://minio.minio.svc:9000", publicUrl: "https://minio.example", s3ForcePathStyle: "true" },
    };

    expect(checkOrigin(`https://minio.example/bucket/backups/a/a-logs.gz${QUERY}`, location)).toEqual({
      verdict: "known",
      origin: "https://minio.example",
      bucket: "path",
    });
    // The port of the scheme, written or not, and a host in capitals, are the same origin.
    expect(checkOrigin(`https://MINIO.example:443/bucket/backups/a/a-logs.gz${QUERY}`, location)).toMatchObject({
      verdict: "known",
      origin: "https://minio.example",
    });
    expect(checkOrigin(`http://minio.minio.svc:9000/bucket/backups/a/a-logs.gz${QUERY}`, location)).toEqual({
      verdict: "refused",
      rule: "public-url",
    });
    // Without the path forced the bucket may be a label of the host of the public URL, and not of the store.
    const free = { ...location, config: { ...location.config, s3ForcePathStyle: "false" } };

    expect(checkOrigin(`https://bucket.minio.example/backups/a/a-logs.gz${QUERY}`, free)).toMatchObject({
      verdict: "known",
      bucket: "host",
    });
    expect(checkOrigin(`http://bucket.minio.minio.svc:9000/backups/a/a-logs.gz${QUERY}`, free).verdict).toBe(
      "allowance",
    );
  });

  it("knows the endpoints of the two partitions of AWS for a location without a URL of its own", () => {
    const location = { provider: "aws", bucket: "my-backups", config: { region: "eu-south-1" } };

    for (const [url, bucket] of [
      ["https://my-backups.s3.eu-south-1.amazonaws.com/backups/a/a-logs.gz", "host"],
      ["https://my-backups.s3.amazonaws.com/backups/a/a-logs.gz", "host"],
      ["https://s3.eu-south-1.amazonaws.com/my-backups/backups/a/a-logs.gz", "path"],
      ["https://my-backups.s3.cn-north-1.amazonaws.com.cn/backups/a/a-logs.gz", "host"],
      ["https://s3.cn-north-1.amazonaws.com.cn/my-backups/backups/a/a-logs.gz", "path"],
      ["https://s3.amazonaws.com/my-backups/backups/a/a-logs.gz", "path"],
      // The origin is known by the first folder of the path alone: what follows it is for the path rule,
      // which refuses a path that is not the key, and the operator is not asked to allow an origin for it.
      ["https://s3.eu-south-1.amazonaws.com/my-backups//backups/a/a-logs.gz", "path"],
      ["https://s3.eu-south-1.amazonaws.com/my-backups/backups/%ZZ", "path"],
      ["https://s3.eu-south-1.amazonaws.com/my%2Dbackups/backups/a/a-logs.gz", "path"],
      // The other endpoints of S3: the two stacks, the validated ones, the older form, the accelerated one.
      ["https://my-backups.s3.dualstack.eu-south-1.amazonaws.com/backups/a/a-logs.gz", "host"],
      ["https://s3.dualstack.eu-south-1.amazonaws.com/my-backups/backups/a/a-logs.gz", "path"],
      ["https://my-backups.s3-fips.us-gov-west-1.amazonaws.com/backups/a/a-logs.gz", "host"],
      ["https://s3-fips.dualstack.us-east-1.amazonaws.com/my-backups/backups/a/a-logs.gz", "path"],
      ["https://s3-eu-west-1.amazonaws.com/my-backups/backups/a/a-logs.gz", "path"],
      ["https://my-backups.s3-accelerate.amazonaws.com/backups/a/a-logs.gz", "host"],
      ["https://my-backups.s3-accelerate.dualstack.amazonaws.com/backups/a/a-logs.gz", "host"],
      // A host that begins with the bucket has the bucket there, whatever its path begins with.
      ["https://my-backups.s3.eu-south-1.amazonaws.com/my-backups/backups/a/a-logs.gz", "host"],
    ] as const)
      expect([url, checkOrigin(`${url}${QUERY}`, location)]).toEqual([
        url,
        { verdict: "known", origin: new URL(url).origin, bucket },
      ]);
    // Another bucket, another partition, a host that only ends with the letters of the domain, plain
    // HTTP and a port are origins the location does not give: they are for the operator to allow.
    for (const url of [
      "https://another.s3.eu-south-1.amazonaws.com/backups/a/a-logs.gz",
      "https://s3.eu-south-1.amazonaws.com/another/backups/a/a-logs.gz",
      "https://my-backups.s3.us-iso-east-1.c2s.ic.gov/backups/a/a-logs.gz",
      "https://my-backups.s3.notamazonaws.com/backups/a/a-logs.gz",
      "https://my-backups.s3amazonaws.com/backups/a/a-logs.gz",
      "https://my-backups.s3.eu-south-1.amazonaws.com.attacker.example/backups/a/a-logs.gz",
      "http://my-backups.s3.eu-south-1.amazonaws.com/backups/a/a-logs.gz",
      "https://my-backups.s3.eu-south-1.amazonaws.com:8443/backups/a/a-logs.gz",
      // A host of the same domain that is not an endpoint of S3, or is the one of another bucket, with a
      // folder named as the bucket of the location: what it serves is not of the location.
      "https://another.s3.eu-south-1.amazonaws.com/my-backups/backups/a/a-logs.gz",
      "https://abc123.execute-api.eu-south-1.amazonaws.com/my-backups/backups/a/a-logs.gz",
      "https://my-backups.execute-api.eu-south-1.amazonaws.com/backups/a/a-logs.gz",
      "https://balancer.eu-south-1.elb.amazonaws.com/my-backups/backups/a/a-logs.gz",
      "https://ec2-203-0-113-7.compute.amazonaws.com/my-backups/backups/a/a-logs.gz",
      "https://my-backups.s3.eu-south-1.other.amazonaws.com/backups/a/a-logs.gz",
      "https://my-backups.other.s3.eu-south-1.amazonaws.com/backups/a/a-logs.gz",
      "https://s3.eu-south-1.amazonaws.com.cn.attacker.example/my-backups/backups/a/a-logs.gz",
      // The accelerated endpoint has the bucket in its host, and never in its path.
      "https://s3-accelerate.amazonaws.com/my-backups/backups/a/a-logs.gz",
      // An endpoint of S3 whose path does not begin with the bucket, or with a folder that decodes.
      "https://s3.eu-south-1.amazonaws.com//my-backups/backups/a/a-logs.gz",
      "https://s3.eu-south-1.amazonaws.com/%ZZ/backups/a/a-logs.gz",
      "https://s3.eu-south-1.amazonaws.com/",
    ])
      expect([url, checkOrigin(`${url}${QUERY}`, location)]).toEqual([
        url,
        { verdict: "allowance", origin: new URL(url).origin },
      ]);
  });

  it("leaves to the operator every origin of a provider the rules were not written for", () => {
    for (const provider of ["azure", "velero.io/gcp", "example.io/s3", "", undefined, 7]) {
      const location = { provider, bucket: "bucket", config: { s3Url: "https://storage.example" } };

      expect([provider, checkOrigin("https://storage.example/bucket/backups/a/a-logs.gz", location)]).toEqual([
        provider,
        { verdict: "allowance", origin: "https://storage.example" },
      ]);
    }
    // A location of AWS without a bucket, or with a URL of its store that is not one, gives no origin.
    expect(
      checkOrigin("https://storage.example/x", { provider: "aws", config: { s3Url: "https://storage.example" } })
        .verdict,
    ).toBe("allowance");
    expect(
      checkOrigin("https://storage.example/x", {
        provider: "aws",
        bucket: "bucket",
        config: { s3Url: "storage.example" },
      }).verdict,
    ).toBe("allowance");
  });

  it("refuses a URL with a user, a fragment, another scheme, or that is not one, whatever the location", () => {
    const location = { provider: "aws", bucket: "bucket", config: { s3Url: "https://storage.example" } };

    for (const [url, rule] of [
      ["https://user@storage.example/bucket/x", "user"],
      ["https://user:secret@storage.example/bucket/x", "user"],
      ["https://:secret@storage.example/bucket/x", "user"],
      ["https://storage.example/bucket/x#fragment", "fragment"],
      ["https://storage.example/bucket/x#", "fragment"],
      ["ftp://storage.example/bucket/x", "scheme"],
      ["file:///etc/passwd", "scheme"],
      ["javascript:alert(1)", "scheme"],
      ["storage.example/bucket/x", "form"],
      ["https://storage.example/bucket/a b", "form"],
      ["https://storage.example/bucket/è", "form"],
      [`https://storage.example/${"a".repeat(8192)}`, "form"],
      ["", "form"],
    ] as const)
      expect([url.slice(0, 60), checkOrigin(url, location)]).toEqual([url.slice(0, 60), { verdict: "refused", rule }]);
    expect(checkOrigin(7 as never, location)).toEqual({ verdict: "refused", rule: "form" });
  });
});

describe("the path of a signed URL, against the key of the artifact that was asked", () => {
  const location = { provider: "aws", bucket: "bucket", prefix: "clusters/prod" };

  it("is the key of each of the eight artifacts in the layout of the release, under the prefix of the location", () => {
    expect(
      Object.fromEntries(ARTIFACT_TARGETS.map((target) => [target, artifactKey(target, "nightly", "")?.join("/")])),
    ).toEqual({
      BackupLog: "backups/nightly/nightly-logs.gz",
      RestoreLog: "restores/nightly/restore-nightly-logs.gz",
      BackupResults: "backups/nightly/nightly-results.gz",
      RestoreResults: "restores/nightly/restore-nightly-results.gz",
      BackupResourceList: "backups/nightly/nightly-resource-list.json.gz",
      RestoreResourceList: "restores/nightly/restore-nightly-resource-list.json.gz",
      BackupVolumeInfos: "backups/nightly/nightly-volumeinfo.json.gz",
      RestoreVolumeInfo: "restores/nightly/nightly-volumeinfo.json.gz",
    });
    // A prefix is read with the slash it ends with or without it, and a location without one has none.
    for (const prefix of ["clusters/prod", "clusters/prod/"])
      expect(artifactKey("BackupLog", "nightly", prefix)?.join("/")).toBe(
        "clusters/prod/backups/nightly/nightly-logs.gz",
      );
    for (const prefix of ["", undefined, null, 7])
      expect(artifactKey("BackupLog", "nightly", prefix)?.join("/")).toBe("backups/nightly/nightly-logs.gz");
    // A prefix is read as the release reads it: the slashes around it taken off, and its path cleaned of
    // empty folders, of the folder itself and of the one above.
    for (const [prefix, cleaned] of [
      ["/clusters/prod", "clusters/prod/"],
      ["/clusters/prod/", "clusters/prod/"],
      ["//clusters/prod//", "clusters/prod/"],
      ["clusters//prod", "clusters/prod/"],
      ["./clusters/prod", "clusters/prod/"],
      ["clusters/./prod/.", "clusters/prod/"],
      ["clusters/other/../prod", "clusters/prod/"],
      ["//", ""],
      ["/", ""],
      [".", ""],
      ["clusters/..", ""],
    ])
      expect([prefix, artifactKey("BackupLog", "nightly", prefix)?.join("/")]).toEqual([
        prefix,
        `${cleaned}backups/nightly/nightly-logs.gz`,
      ]);
    // A prefix that climbs above the bucket, and a name that is a path, give no key.
    for (const prefix of ["..", "../other", "clusters/../../other", "/../clusters"])
      expect([prefix, artifactKey("BackupLog", "nightly", prefix)]).toEqual([prefix, undefined]);
    for (const name of ["", "a/b", "../other"])
      expect([name, artifactKey("BackupLog", name, "")]).toEqual([name, undefined]);
  });

  it("reads the bucket of a location as the release reads it, and takes none that the release refuses", () => {
    const key = "/clusters/prod/backups/nightly/nightly-logs.gz";

    // The slashes around a bucket are taken off; one inside it is a location the release does not open.
    for (const bucket of ["bucket", "bucket/", "/bucket", "//bucket//"])
      expect([
        bucket,
        isArtifactPath(`/bucket${key}`, "BackupLog", "nightly", { ...location, bucket }, "path"),
      ]).toEqual([bucket, true]);
    for (const bucket of ["bucket/clusters", "a/b", "/", "", undefined, 7])
      for (const where of ["host", "path", "either"] as const)
        expect([bucket, isArtifactPath(key, "BackupLog", "nightly", { ...location, bucket }, where)]).toEqual([
          bucket,
          false,
        ]);
    // The same for the origin: a bucket written with a slash after it is a label of the host without it.
    expect(
      checkOrigin(`https://bucket.storage.example${key}`, {
        provider: "aws",
        bucket: "bucket/",
        config: { s3Url: "https://storage.example" },
      }),
    ).toEqual({ verdict: "known", origin: "https://bucket.storage.example", bucket: "host" });
  });

  it("is that key alone when the bucket is in the host, after the bucket when it is in the path, and either when it is not known", () => {
    const key = "/clusters/prod/backups/nightly/nightly-logs.gz";

    expect(isArtifactPath(key, "BackupLog", "nightly", location, "host")).toBe(true);
    expect(isArtifactPath(key, "BackupLog", "nightly", location, "path")).toBe(false);
    expect(isArtifactPath(`/bucket${key}`, "BackupLog", "nightly", location, "path")).toBe(true);
    expect(isArtifactPath(`/bucket${key}`, "BackupLog", "nightly", location, "host")).toBe(false);
    expect(isArtifactPath(key, "BackupLog", "nightly", location, "either")).toBe(true);
    expect(isArtifactPath(`/bucket${key}`, "BackupLog", "nightly", location, "either")).toBe(true);
    expect(isArtifactPath(`/another${key}`, "BackupLog", "nightly", location, "either")).toBe(false);
    // What the signer encoded in a segment is read as it was written.
    expect(
      isArtifactPath(
        "/bucket/clusters%2Dof/prod%20one/backups/nightly/nightly-logs.gz",
        "BackupLog",
        "nightly",
        {
          bucket: "bucket",
          prefix: "clusters-of/prod one",
        },
        "path",
      ),
    ).toBe(true);
  });

  it("is of that artifact of that target and of no other file of the store", () => {
    for (const other of [
      // The contents of the same backup, its metadata, another artifact of it, another backup, a restore.
      "/bucket/clusters/prod/backups/nightly/nightly.tar.gz",
      "/bucket/clusters/prod/backups/nightly/velero-backup.json",
      "/bucket/clusters/prod/backups/nightly/nightly-results.gz",
      "/bucket/clusters/prod/backups/other/other-logs.gz",
      "/bucket/clusters/prod/backups/other/nightly-logs.gz",
      "/bucket/clusters/prod/restores/nightly/restore-nightly-logs.gz",
      // Another prefix, none, one more folder, the same key under another one.
      "/bucket/clusters/test/backups/nightly/nightly-logs.gz",
      "/bucket/backups/nightly/nightly-logs.gz",
      "/bucket/clusters/prod/backups/nightly/nightly-logs.gz/more",
      "/bucket/x/clusters/prod/backups/nightly/nightly-logs.gz",
      // Segments that are not what they read as.
      "/bucket/clusters/prod/backups/nightly/../nightly/nightly-logs.gz",
      "/bucket/clusters/prod/backups/nightly/%2E%2E/nightly/nightly-logs.gz",
      "/bucket/clusters/prod/backups%2Fnightly/nightly-logs.gz",
      "/bucket/clusters/prod//backups/nightly/nightly-logs.gz",
      "/bucket/clusters/prod/backups/nightly/nightly-logs.gz/",
      "/bucket/clusters/prod/backups/nightly/nightly-logs.gz%",
      "bucket/clusters/prod/backups/nightly/nightly-logs.gz",
      "",
    ])
      expect([other, isArtifactPath(other, "BackupLog", "nightly", location, "either")]).toEqual([other, false]);
    // A bucket whose name is the folder above, or a path, as an object of the cluster may carry it: a
    // segment that reads as one of them is no segment, and the path is of no key.
    for (const [bucket, path] of [
      ["..", "/../clusters/prod/backups/nightly/nightly-logs.gz"],
      [".", "/./clusters/prod/backups/nightly/nightly-logs.gz"],
      ["a/b", "/a%2Fb/clusters/prod/backups/nightly/nightly-logs.gz"],
    ])
      expect([bucket, isArtifactPath(path, "BackupLog", "nightly", { ...location, bucket }, "path")]).toEqual([
        bucket,
        false,
      ]);
    // A location without a bucket has no key to compare with.
    expect(isArtifactPath("/backups/nightly/nightly-logs.gz", "BackupLog", "nightly", { prefix: "" }, "either")).toBe(
      false,
    );
  });
});

describe("what the host of a signed URL names, by its form", () => {
  it("reads a name of the form of a Service as one, with or without the domain of the cluster", () => {
    for (const host of [
      "seaweedfs.velero-demo.svc",
      "seaweedfs.velero-demo.svc.cluster.local",
      "seaweedfs.velero-demo.svc.cluster.local.",
      "seaweedfs.velero-demo.svc.k8s.example",
    ])
      expect([host, hostForm(host)]).toEqual([host, { form: "service", name: "seaweedfs", namespace: "velero-demo" }]);
  });

  it("reads a bare name and a name with a namespace as what may be a Service, and every other name as a name", () => {
    expect(hostForm("minio")).toEqual({ form: "candidate", name: "minio" });
    expect(hostForm("minio.storage")).toEqual({ form: "candidate", name: "minio", namespace: "storage" });
    // A name of two labels is how a public name is written as well: it is the cluster that says which.
    expect(hostForm("example.com")).toEqual({ form: "candidate", name: "example", namespace: "com" });
    for (const host of [
      "s3.eu-south-1.amazonaws.com",
      "storage.example.com",
      "minio.storage.service",
      "svc.minio.storage",
      "a.b.c",
      "-minio",
      "minio_1",
      "under_score.namespace.svc",
      "",
    ])
      expect([host, hostForm(host)]).toEqual([host, { form: "name" }]);
  });

  it("reads an address as an address, in every form the runtime writes one", () => {
    for (const url of [
      "http://10.0.0.1:9000/",
      "http://[::1]:9000/",
      "http://[fd00:ec2::254]/",
      // What reads as numbers is an address for the runtime, which writes it as four.
      "http://2130706433/",
      "http://0x7f.1/",
      "http://127.1/",
    ])
      expect([url, hostForm(new URL(url).hostname)]).toEqual([url, { form: "address" }]);
  });
});
