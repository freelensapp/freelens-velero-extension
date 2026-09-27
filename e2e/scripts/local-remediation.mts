import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { localEnvironment, requireCondition } from "./local-kind.mts";
import { IMAGES } from "./local-manifests.mts";
import { binaryReportHasNoCalls } from "./local-security.mts";

const STATE = join(homedir(), ".local", "state", "freelens-velero-dev");
const BUILD = join(STATE, "builds");
const GO = join(STATE, "tools", "go1.27.1", "bin", "go");
const environment = {
  ...localEnvironment({}, "/dev/null"),
  PATH: process.env.PATH,
  HOME: join(STATE, "home"),
  DOCKER_CONFIG: join(STATE, "docker"),
  GOTOOLCHAIN: "local",
  GOENV: "off",
  GOWORK: "off",
  GOTELEMETRY: "off",
  GOPROXY: "https://proxy.golang.org",
  GOSUMDB: "sum.golang.org",
  GOPATH: join(STATE, "go"),
  GOCACHE: join(STATE, "go-cache"),
  CGO_ENABLED: "0",
  GOMAXPROCS: "4",
  GOMEMLIMIT: "6GiB",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};
const STORAGE_SOURCE = "c5073360007d28385a33426a42ac3e4ec504c5a3";
const PATCHED_GRPC = "v1.85.0-dev.0.20260825072537-93e31b48545e";

function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function run(executable: string, args: string[], directory: string, timeout = 1_200_000): string {
  try {
    const output = execFileSync(executable, args, {
      env: environment,
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      maxBuffer: 32 * 1024 ** 2,
    });

    appendFileSync(join(directory, "build.log"), `${executable} ${args.join(" ")}\n${output}\n`, { mode: 0o600 });
    return output;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };

    appendFileSync(
      join(directory, "build.log"),
      `${executable}: exit ${failure.status ?? "unknown"}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n`,
      { mode: 0o600 },
    );
    throw new Error("Local remediation command failed; details retained in its private build log");
  }
}

async function source(repository: string, revision: string, directory: string): Promise<void> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(join(directory, "source.json"))) {
    const provenance = JSON.parse(readFileSync(join(directory, "source.json"), "utf8")) as {
      repository: string;
      revision: string;
      sha256: string;
    };

    requireCondition(
      provenance.repository === repository &&
        provenance.revision === revision &&
        digest(join(directory, "source.tar.gz")) === provenance.sha256,
      "Changed remediation source archive",
    );
    return;
  }
  const url = `https://codeload.github.com/${repository}/tar.gz/${revision}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });

  requireCondition(response.ok, "Pinned public source download failed");
  const archive = join(directory, "source.tar.gz");

  writeFileSync(archive, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
  run("tar", ["-xzf", archive, "--strip-components=1", "-C", directory], directory);
  cpSync(join(directory, "go.mod"), join(directory, "go.mod.upstream"));
  cpSync(join(directory, "go.sum"), join(directory, "go.sum.upstream"));
  writeFileSync(
    join(directory, "source.json"),
    JSON.stringify({ repository, revision, url, sha256: digest(archive) }),
    { mode: 0o600 },
  );
}

function scan(name: string, image: string, directory: string): number {
  const file = join(directory, "trivy.json");
  const result = spawnSync(
    "trivy",
    [
      "image",
      "--image-src",
      "docker",
      "--scanners",
      "vuln",
      "--db-repository",
      "ghcr.io/aquasecurity/trivy-db:2",
      "--cache-dir",
      join(homedir(), ".cache", "trivy"),
      "--format",
      "json",
      "--output",
      file,
      "--quiet",
      "--exit-code",
      "1",
      image,
    ],
    { env: environment, encoding: "utf8", timeout: 660_000 },
  );

  writeFileSync(join(directory, "trivy.stderr"), result.stderr ?? "", { mode: 0o600 });
  requireCondition(result.status === 0 || result.status === 1, "Image scan execution failed");
  const report = JSON.parse(readFileSync(file, "utf8")) as {
    Results?: {
      Vulnerabilities?: {
        Severity: string;
        VulnerabilityID: string;
        PkgName: string;
        InstalledVersion: string;
        FixedVersion?: string;
      }[];
    }[];
  };
  const findings = report.Results?.flatMap((section) => section.Vulnerabilities ?? []) ?? [];
  const counts = Object.fromEntries(
    ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"].map((severity) => [
      severity,
      findings.filter((finding) => finding.Severity === severity).length,
    ]),
  );

  console.log(
    JSON.stringify({
      image: name,
      scannerExit: result.status,
      counts,
      findings:
        findings.length <= 30
          ? findings.map((finding) => ({
              id: finding.VulnerabilityID,
              package: finding.PkgName,
              installed: finding.InstalledVersion,
              fixed: finding.FixedVersion,
            }))
          : undefined,
    }),
  );
  return result.status;
}

async function nodeImage(): Promise<void> {
  const directory = join(BUILD, "node-1.34.11-security1");
  const context = join(directory, "image");
  const kubernetes = join(BUILD, "kubernetes-1.34.11-security1");
  const revision = "3a634765b787dd069f7f714fa77d767cb7d43795";

  mkdirSync(context, { recursive: true, mode: 0o700 });
  await source("kubernetes/kubernetes", revision, kubernetes);
  run(
    GO,
    [
      "get",
      "google.golang.org/grpc@v1.83.2",
      "go.opentelemetry.io/otel/sdk@v1.45.0",
      "go.opentelemetry.io/otel/exporters/otlp/otlptrace@v1.45.0",
      "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc@v1.45.0",
      "golang.org/x/crypto@v0.56.0",
      "golang.org/x/net@v0.58.0",
      "golang.org/x/text@v0.41.0",
      "golang.org/x/mod@v0.40.0",
      "github.com/opencontainers/selinux@v1.13.0",
      "github.com/google/cel-go@v0.29.0",
    ],
    kubernetes,
  );
  const flags = `-X k8s.io/component-base/version.gitVersion=v1.34.11 -X k8s.io/component-base/version.gitCommit=${revision} -X k8s.io/component-base/version.gitTreeState=dirty`;

  for (const binary of ["kubeadm", "kubelet", "kubectl"]) {
    run(
      GO,
      ["build", "-mod=mod", "-p=4", "-trimpath", "-ldflags", flags, "-o", join(context, binary), `./cmd/${binary}`],
      kubernetes,
    );
    const version = run(
      join(context, binary),
      binary === "kubectl"
        ? ["version", "--client=true", "-o", "json"]
        : binary === "kubeadm"
          ? ["version", "-o", "short"]
          : ["--version"],
      directory,
    );

    requireCondition(version.includes("v1.34.11"), "Patched Kubernetes binary version mismatch");
  }
  const runtimeSources = [
    {
      name: "containerd-2.3.5",
      repository: "containerd/containerd",
      revision: "1294c24a7da8e5a793ed378161673abe94118892",
      targets: ["containerd", "containerd-shim-runc-v2", "ctr"],
      updates: ["github.com/cilium/ebpf@v0.22.0"],
      flags: "-X github.com/containerd/containerd/v2/version.Version=v2.3.5",
    },
    {
      name: "cri-tools",
      repository: "kubernetes-sigs/cri-tools",
      revision: "88d8ad9d40f82726fda53c2d271e6172b4c619c9",
      targets: ["crictl"],
      updates: [] as string[],
      flags: "-X sigs.k8s.io/cri-tools/pkg/version.Version=v1.36.0",
    },
    {
      name: "fuse-overlayfs",
      repository: "containerd/fuse-overlayfs-snapshotter",
      revision: "da57796c7d0a2b608abf173651cf148706e33337",
      targets: ["containerd-fuse-overlayfs-grpc"],
      updates: ["github.com/containerd/containerd/v2@v2.3.5", "github.com/cilium/ebpf@v0.22.0"],
      flags: "",
    },
  ];

  for (const component of runtimeSources) {
    const workingDirectory = join(BUILD, `${component.name}-security1`);

    await source(component.repository, component.revision, workingDirectory);
    run(
      GO,
      [
        "get",
        "google.golang.org/grpc@v1.83.2",
        "go.opentelemetry.io/otel/sdk@v1.45.0",
        "go.opentelemetry.io/otel/exporters/otlp/otlptrace@v1.45.0",
        "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc@v1.45.0",
        "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp@v1.45.0",
        "golang.org/x/crypto@v0.56.0",
        "golang.org/x/net@v0.58.0",
        "golang.org/x/text@v0.41.0",
        "golang.org/x/mod@v0.40.0",
        ...component.updates,
      ],
      workingDirectory,
    );
    for (const binary of component.targets)
      run(
        GO,
        [
          "build",
          "-mod=mod",
          "-p=4",
          "-trimpath",
          "-ldflags",
          component.flags,
          "-o",
          join(context, binary),
          `./cmd/${binary}`,
        ],
        workingDirectory,
      );
  }
  writeFileSync(
    join(context, "Dockerfile"),
    `FROM ${IMAGES.node}\nENV DEBIAN_FRONTEND=noninteractive\nRUN ["apt-get", "update"]\nRUN ["apt-get", "-y", "dist-upgrade"]\nRUN ["apt-get", "clean"]\nRUN ["rm", "-rf", "/var/lib/apt/lists"]\nCOPY --chmod=0755 kubeadm kubelet kubectl /usr/bin/\nCOPY --chmod=0755 containerd containerd-shim-runc-v2 ctr crictl containerd-fuse-overlayfs-grpc /usr/local/bin/\nLABEL io.freelens.velero.lab.source="${revision}"\nLABEL io.freelens.velero.lab.patched="true"\n`,
    { mode: 0o600 },
  );
  const tag = "freelens-velero-lab/node:1.34.11-security1";

  run("docker", ["build", "--pull=false", "--tag", tag, context], directory);
  const [image] = JSON.parse(run("docker", ["image", "inspect", tag], directory)) as { Id: string }[];
  const packages = run(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--entrypoint=dpkg-query",
      tag,
      "-W",
      "-f=${Package}\t${Version}\n",
    ],
    directory,
  );

  writeFileSync(join(directory, "packages.tsv"), packages, { mode: 0o600 });
  const exitCode = scan("patched-node-os", tag, directory);
  const provenance = {
    base: IMAGES.node,
    source: revision,
    runtimeSources,
    tag,
    dockerId: image.Id,
    binaries: Object.fromEntries(
      ["kubeadm", "kubelet", "kubectl", ...runtimeSources.flatMap((component) => component.targets)].map((binary) => [
        binary,
        digest(join(context, binary)),
      ]),
    ),
    osPackagesSha256: digest(join(directory, "packages.tsv")),
    scannerExit: exitCode,
    securityQualified: exitCode === 0,
    runtimeQualified: false,
  };

  writeFileSync(join(directory, "image.json"), JSON.stringify(provenance, null, 2), { mode: 0o600 });
  const index = join(STATE, "patched-images.json");
  const images = existsSync(index) ? (JSON.parse(readFileSync(index, "utf8")) as Record<string, unknown>) : {};

  images.node = provenance;
  writeFileSync(`${index}.next`, JSON.stringify(images, null, 2), { mode: 0o600 });
  renameSync(`${index}.next`, index);
  process.exitCode = exitCode;
}

async function velero(): Promise<void> {
  const revision = "c253c7fe37d78c9b7e55c68544f7c5b2608712d8";
  const resticRevision = "37d0e1fe58a35bea1eac4d92b4cc5963ca3b44bd";
  const directory = join(BUILD, "velero-1.18.2-security1");
  const restic = join(BUILD, "restic-0.15.0-security1");

  await source("vmware-tanzu/velero", revision, directory);
  await source("restic/restic", resticRevision, restic);
  const patch = join(directory, "hack", "fix_restic_cve.txt");
  const marker = join(restic, "velero-patch.json");

  if (!existsSync(marker)) {
    run("git", ["apply", "--check", patch], restic);
    run("git", ["apply", patch], restic);
    writeFileSync(marker, JSON.stringify({ sha256: digest(patch) }), { mode: 0o600 });
  }
  const updates = [
    "google.golang.org/grpc@v1.83.2",
    "golang.org/x/crypto@v0.56.0",
    "golang.org/x/net@v0.58.0",
    "golang.org/x/text@v0.41.0",
    "golang.org/x/mod@v0.40.0",
    "go.opentelemetry.io/otel/sdk@v1.45.0",
    "github.com/klauspost/compress@v1.18.7",
  ];

  run(GO, ["get", ...updates], directory);
  run(GO, ["get", ...updates], restic);
  const context = join(directory, "image");

  mkdirSync(context, { recursive: true, mode: 0o700 });
  const flags = `-X github.com/vmware-tanzu/velero/pkg/buildinfo.Version=v1.18.2 -X github.com/vmware-tanzu/velero/pkg/buildinfo.GitSHA=${revision} -X github.com/vmware-tanzu/velero/pkg/buildinfo.GitTreeState=dirty -X github.com/vmware-tanzu/velero/pkg/buildinfo.ImageRegistry=freelens-velero-lab`;

  for (const binary of ["velero", "velero-helper", "velero-restore-helper"])
    run(
      GO,
      [
        "build",
        "-p=4",
        "-trimpath",
        "-tags=timetzdata",
        "-ldflags",
        flags,
        "-o",
        join(context, binary),
        `./cmd/${binary}`,
      ],
      directory,
    );
  run(
    GO,
    [
      "build",
      "-p=4",
      "-trimpath",
      "-tags=timetzdata",
      "-ldflags",
      "-X main.version=0.15.0-security1",
      "-o",
      join(context, "restic"),
      "./cmd/restic",
    ],
    restic,
  );
  const user = process.getuid?.();
  const group = process.getgid?.();

  requireCondition(typeof user === "number" && typeof group === "number", "A local Unix identity is required");
  for (const [name, target] of [
    ["persistence", "./pkg/persistence"],
    ["downloadrequest", "./pkg/cmd/util/downloadrequest"],
  ]) {
    run(GO, ["test", "-c", "-p=4", "-o", `${name}-tests`, target], directory);
    const tests = run(
      "docker",
      [
        "run",
        "--rm",
        "--pull=never",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        `--user=${user}:${group}`,
        "--security-opt=no-new-privileges",
        "--memory=1g",
        "--cpus=2",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=256m",
        "--mount",
        `type=bind,src=${directory},dst=/source,readonly`,
        "--workdir=/source",
        `--entrypoint=/source/${name}-tests`,
        IMAGES.node,
        "-test.v",
        "-test.timeout=120s",
      ],
      directory,
      180_000,
    );

    requireCondition(tests.trim().endsWith("PASS"), `Velero ${name} tests failed`);
    writeFileSync(join(directory, `${name}-tests.txt`), tests, { mode: 0o600 });
    console.log(
      `PASS: ${tests.split("\n").filter((line) => line.startsWith("--- PASS:")).length} Velero ${name} tests without network access.`,
    );
  }
  mkdirSync(join(context, "tmp"), { recursive: true });
  writeFileSync(
    join(context, "Dockerfile"),
    `FROM ${IMAGES.velero} AS upstream\nFROM scratch\nCOPY --from=upstream /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt\nCOPY --from=upstream /etc/passwd /etc/group /etc/\nCOPY --chmod=1777 tmp/ /tmp/\nCOPY --chmod=0755 velero velero-helper velero-restore-helper /\nCOPY --chmod=0755 restic /usr/bin/restic\nENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin TZ=UTC\nUSER cnb:cnb\nWORKDIR /\nLABEL io.freelens.velero.lab.source="${revision}"\nLABEL io.freelens.velero.lab.patched="true"\n`,
    { mode: 0o600 },
  );
  const tag = "freelens-velero-lab/velero:1.18.2-security1";

  run("docker", ["build", "--network=none", "--pull=false", "--tag", tag, context], directory);
  const version = run(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--entrypoint=/velero",
      tag,
      "version",
      "--client-only",
    ],
    directory,
  );

  requireCondition(version.includes("v1.18.2"), "Patched Velero client version failed");
  run(
    "docker",
    ["run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL", "--entrypoint=/usr/bin/restic", tag, "version"],
    directory,
  );
  const [image] = JSON.parse(run("docker", ["image", "inspect", tag], directory)) as { Id: string }[];
  const exitCode = scan("patched-velero", tag, directory);
  const report = JSON.parse(readFileSync(join(directory, "trivy.json"), "utf8")) as {
    Results?: { Vulnerabilities?: { VulnerabilityID: string }[] }[];
  };
  const remaining = report.Results?.flatMap((section) => section.Vulnerabilities ?? []) ?? [];
  let openpgpAbsent = true;
  let binaryAnalysisPassed = true;

  for (const [binary, target, workingDirectory] of [
    ["velero", "./cmd/velero", directory],
    ["velero-helper", "./cmd/velero-helper", directory],
    ["velero-restore-helper", "./cmd/velero-restore-helper", directory],
    ["restic", "./cmd/restic", restic],
  ]) {
    const packages = run(GO, ["list", "-deps", "-tags=timetzdata", target], workingDirectory).trim().split("\n");

    openpgpAbsent &&= !packages.some(
      (name) => name === "golang.org/x/crypto/openpgp" || name.startsWith("golang.org/x/crypto/openpgp/"),
    );
    writeFileSync(join(directory, `${binary}-packages.json`), JSON.stringify(packages), { mode: 0o600 });
    const analysis = spawnSync(
      join(environment.GOPATH, "bin", "govulncheck"),
      ["-mode=binary", "-format=sarif", join(context, binary)],
      { env: environment, encoding: "utf8", timeout: 300_000, maxBuffer: 32 * 1024 ** 2 },
    );

    writeFileSync(join(directory, `${binary}-govulncheck.json`), analysis.stdout ?? "", { mode: 0o600 });
    binaryAnalysisPassed &&= analysis.status === 0 && binaryReportHasNoCalls(analysis.stdout);
  }
  const securityQualified =
    binaryAnalysisPassed && openpgpAbsent && remaining.every((finding) => finding.VulnerabilityID === "GO-2026-5932");
  const provenance = {
    source: revision,
    resticSource: resticRevision,
    assetsFrom: IMAGES.velero,
    runtimeBase: "scratch",
    tag,
    dockerId: image.Id,
    binaries: Object.fromEntries(
      ["velero", "velero-helper", "velero-restore-helper", "restic"].map((binary) => [
        binary,
        digest(join(context, binary)),
      ]),
    ),
    goModSha256: digest(join(directory, "go.mod")),
    goSumSha256: digest(join(directory, "go.sum")),
    go: "1.27.1",
    scannerExit: exitCode,
    openpgpAbsent,
    binaryAnalysisPassed,
    securityQualified,
    runtimeQualified: false,
  };

  writeFileSync(join(directory, "image.json"), JSON.stringify(provenance, null, 2), { mode: 0o600 });
  const index = join(STATE, "patched-images.json");
  const images = existsSync(index) ? (JSON.parse(readFileSync(index, "utf8")) as Record<string, unknown>) : {};

  images.velero = provenance;
  writeFileSync(`${index}.next`, JSON.stringify(images, null, 2), { mode: 0o600 });
  renameSync(`${index}.next`, index);
  console.log(
    `Velero applicability gate: ${securityQualified ? "PASS" : "FAIL"}; unfiltered reports retained. Cluster runtime remains unverified.`,
  );
  process.exitCode = securityQualified ? 0 : 1;
}

async function plugin(): Promise<void> {
  const revision = "5463822fd77bc1c2a1151ee76c830ad979ff2781";
  const directory = join(BUILD, "plugin-1.14.2-security1");

  await source("vmware-tanzu/velero-plugin-for-aws", revision, directory);
  run(
    GO,
    [
      "get",
      "google.golang.org/grpc@v1.83.2",
      "golang.org/x/net@v0.58.0",
      "golang.org/x/text@v0.41.0",
      "github.com/vmware-tanzu/velero@v1.18.2",
    ],
    directory,
  );
  run(GO, ["test", "-c", "-p=4", "-o", "plugin-tests", "./velero-plugin-for-aws"], directory);
  const user = process.getuid?.();
  const group = process.getgid?.();

  requireCondition(typeof user === "number" && typeof group === "number", "A local Unix identity is required");
  const tests = run(
    "docker",
    [
      "run",
      "--rm",
      "--pull=never",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      `--user=${user}:${group}`,
      "--security-opt=no-new-privileges",
      "--memory=512m",
      "--cpus=2",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      "--mount",
      `type=bind,src=${directory},dst=/source,readonly`,
      "--workdir=/source/velero-plugin-for-aws",
      "--env=AWS_ACCESS_KEY_ID=synthetic-test-key",
      "--env=AWS_SECRET_ACCESS_KEY=synthetic-test-secret",
      "--env=AWS_REGION=us-east-1",
      "--env=AWS_EC2_METADATA_DISABLED=true",
      "--env=AWS_CONFIG_FILE=/dev/null",
      "--env=AWS_SHARED_CREDENTIALS_FILE=/dev/null",
      "--entrypoint=/source/plugin-tests",
      IMAGES.node,
      "-test.v",
      "-test.timeout=120s",
    ],
    directory,
    180_000,
  );

  requireCondition(tests.trim().endsWith("PASS"), "Upstream plugin unit tests failed");
  writeFileSync(join(directory, "tests.txt"), tests, { mode: 0o600 });
  console.log(
    `PASS: ${tests.split("\n").filter((line) => line.startsWith("--- PASS:")).length} upstream plugin tests in a no-network container.`,
  );
  const context = join(directory, "image");

  mkdirSync(context, { recursive: true, mode: 0o700 });
  for (const [binary, target] of [
    ["velero-plugin-for-aws", "./velero-plugin-for-aws"],
    ["cp-plugin", "./hack/cp-plugin"],
  ]) {
    run(GO, ["build", "-p=4", "-trimpath", "-o", join(context, binary), target], directory);
  }
  writeFileSync(
    join(context, "Dockerfile"),
    `FROM ${IMAGES.plugin}\nCOPY --chmod=0755 velero-plugin-for-aws /plugins/velero-plugin-for-aws\nCOPY --chmod=0755 cp-plugin /bin/cp-plugin\nLABEL io.freelens.velero.lab.source="${revision}"\nLABEL io.freelens.velero.lab.patched="true"\n`,
    { mode: 0o600 },
  );
  const tag = "freelens-velero-lab/plugin:1.14.2-security1";

  run("docker", ["build", "--network=none", "--pull=false", "--tag", tag, context], directory);
  const [image] = JSON.parse(run("docker", ["image", "inspect", tag], directory)) as { Id: string }[];
  const exitCode = scan("patched-plugin", tag, directory);
  const provenance = {
    source: revision,
    base: IMAGES.plugin,
    tag,
    dockerId: image.Id,
    binarySha256: digest(join(context, "velero-plugin-for-aws")),
    helperSha256: digest(join(context, "cp-plugin")),
    goModSha256: digest(join(directory, "go.mod")),
    goSumSha256: digest(join(directory, "go.sum")),
    go: "1.27.1",
    scannerExit: exitCode,
    securityQualified: exitCode === 0,
    runtimeQualified: false,
  };

  writeFileSync(join(directory, "image.json"), JSON.stringify(provenance, null, 2), { mode: 0o600 });
  const index = join(STATE, "patched-images.json");
  const images = existsSync(index) ? (JSON.parse(readFileSync(index, "utf8")) as Record<string, unknown>) : {};

  images.plugin = provenance;
  writeFileSync(`${index}.next`, JSON.stringify(images, null, 2), { mode: 0o600 });
  renameSync(`${index}.next`, index);
  process.exitCode = exitCode;
}

async function storage(): Promise<void> {
  const directory = join(BUILD, "storage-4.47-security1");

  await source("seaweedfs/seaweedfs", STORAGE_SOURCE, directory);
  run(GO, ["get", `google.golang.org/grpc@${PATCHED_GRPC}`], directory);
  run(GO, ["build", "-p=4", "-trimpath", "-o", "patched-weed", "./weed"], directory);
  const buildInfo = run(GO, ["version", "-m", "patched-weed"], directory);

  requireCondition(
    buildInfo.includes(PATCHED_GRPC) && buildInfo.includes("go1.27.1"),
    "Unexpected patched binary provenance",
  );
  run(GO, ["install", "golang.org/x/vuln/cmd/govulncheck@v1.8.0"], directory);
  const analysis = spawnSync(
    join(environment.GOPATH, "bin", "govulncheck"),
    ["-mode=binary", "-format=sarif", "patched-weed"],
    { env: environment, cwd: directory, encoding: "utf8", timeout: 300_000, maxBuffer: 32 * 1024 ** 2 },
  );

  writeFileSync(join(directory, "govulncheck.json"), analysis.stdout ?? "", { mode: 0o600 });
  writeFileSync(join(directory, "govulncheck.stderr"), analysis.stderr ?? "", { mode: 0o600 });
  requireCondition(analysis.status === 0 || analysis.status === 3, "Binary vulnerability analysis failed");
  const packages = run(GO, ["list", "-deps", "./weed"], directory).trim().split("\n");
  const openpgpAbsent = !packages.some(
    (name) => name === "golang.org/x/crypto/openpgp" || name.startsWith("golang.org/x/crypto/openpgp/"),
  );

  writeFileSync(join(directory, "compiled-packages.json"), JSON.stringify(packages), { mode: 0o600 });
  const context = join(directory, "image");

  mkdirSync(context, { recursive: true, mode: 0o700 });
  cpSync(join(directory, "patched-weed"), join(context, "weed"));
  writeFileSync(
    join(context, "Dockerfile"),
    `FROM ${IMAGES.storage}\nCOPY --chmod=0755 weed /usr/bin/weed\nLABEL io.freelens.velero.lab.source="${STORAGE_SOURCE}"\nLABEL io.freelens.velero.lab.patched="true"\n`,
    { mode: 0o600 },
  );
  const tag = "freelens-velero-lab/storage:4.47-security1";

  run("docker", ["build", "--network=none", "--pull=false", "--tag", tag, context], directory);
  const [image] = JSON.parse(run("docker", ["image", "inspect", tag], directory)) as {
    Id: string;
    Os: string;
    Architecture: string;
  }[];

  requireCondition(image.Os === "linux" && image.Architecture === "amd64", "Wrong patched image platform");
  const provenance = {
    source: STORAGE_SOURCE,
    base: IMAGES.storage,
    tag,
    dockerId: image.Id,
    binarySha256: digest(join(context, "weed")),
    goModSha256: digest(join(directory, "go.mod")),
    goSumSha256: digest(join(directory, "go.sum")),
    grpc: PATCHED_GRPC,
    go: "1.27.1",
    govulncheckExit: analysis.status,
  };

  writeFileSync(join(directory, "image.json"), JSON.stringify(provenance, null, 2), { mode: 0o600 });
  const exitCode = scan("patched-storage", tag, directory);
  const report = JSON.parse(readFileSync(join(directory, "trivy.json"), "utf8")) as {
    Results?: { Vulnerabilities?: { VulnerabilityID: string }[] }[];
  };
  const remaining = report.Results?.flatMap((section) => section.Vulnerabilities ?? []) ?? [];
  const securityQualified =
    analysis.status === 0 &&
    binaryReportHasNoCalls(analysis.stdout) &&
    openpgpAbsent &&
    remaining.every((finding) => finding.VulnerabilityID === "GO-2026-5932");
  const applicability = {
    openpgpAbsent,
    govulncheckExit: analysis.status,
    rawScannerExit: exitCode,
    securityQualified,
    rationale:
      "GO-2026-5932 applies only to the openpgp packages, absent from this compiled dependency graph; binary analysis found no vulnerable symbols.",
  };

  writeFileSync(join(directory, "applicability.json"), JSON.stringify(applicability, null, 2), { mode: 0o600 });

  const index = join(STATE, "patched-images.json");
  const images = existsSync(index) ? (JSON.parse(readFileSync(index, "utf8")) as Record<string, unknown>) : {};

  images.storage = { ...provenance, scannerExit: exitCode, securityQualified, runtimeQualified: false };
  writeFileSync(`${index}.next`, JSON.stringify(images, null, 2), { mode: 0o600 });
  renameSync(`${index}.next`, index);
  console.log(
    `Storage applicability gate: ${securityQualified ? "PASS" : "FAIL"}; raw scanner findings are retained. Runtime qualification is pending.`,
  );
  process.exitCode = securityQualified ? 0 : 1;
}

try {
  requireCondition(false, "Retired by user directive: official artifacts only; upstream remediation is disabled.");
  process.umask(0o077);
  requireCondition(
    process.argv.length === 3 && ["storage", "plugin", "velero", "node"].includes(process.argv[2]),
    "Usage: node --use-system-ca e2e/scripts/local-remediation.mts <storage|plugin|velero|node>",
  );
  requireCondition(existsSync(GO), "Private patched Go toolchain is missing");
  mkdirSync(BUILD, { recursive: true, mode: 0o700 });
  if (process.argv[2] === "storage") await storage();
  else if (process.argv[2] === "plugin") await plugin();
  else if (process.argv[2] === "velero") await velero();
  else await nodeImage();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local image remediation failed");
  process.exitCode = 1;
}
