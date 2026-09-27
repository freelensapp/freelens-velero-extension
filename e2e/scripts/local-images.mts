import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { localEnvironment, requireCondition } from "./local-kind.mts";
import { IMAGES, KIND_HOSTS, storageManifests } from "./local-manifests.mts";

const SCANNER_VERSION = "0.74.0";
const GO_VERSION = "1.27.1";
const KIND_VERSION = "0.33.0";
const privateDirectory = mkdtempSync(join(tmpdir(), "velero-image-tools-"));
const environment = {
  ...localEnvironment(process.env, "/dev/null"),
  HOME: privateDirectory,
  DOCKER_CONFIG: privateDirectory,
};

writeFileSync(join(privateDirectory, "config.json"), "{}\n", { mode: 0o600 });

function docker(args: string[]): string {
  return execFileSync("docker", args, {
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 1_200_000,
    maxBuffer: 8 * 1024 ** 2,
  });
}

function pull(): void {
  for (const [name, image] of Object.entries(IMAGES)) {
    docker(["pull", "--platform", "linux/amd64", image]);
    const [inspected] = JSON.parse(docker(["image", "inspect", image])) as {
      Os: string;
      Architecture: string;
      RepoDigests: string[];
    }[];

    requireCondition(
      inspected.Os === "linux" &&
        inspected.Architecture === "amd64" &&
        inspected.RepoDigests.some((digest) => digest.endsWith(image.split("@")[1])),
      "Image identity mismatch",
    );
    console.log(`PASS: ${name} image matches its pinned digest and Linux amd64 platform.`);
  }
}

function probe(): void {
  const sandbox = [
    "run",
    "--rm",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--memory=512m",
    "--cpus=1",
  ];
  const help = spawnSync("docker", [...sandbox, "--entrypoint=weed", IMAGES.storage, "server", "-h"], {
    env: environment,
    encoding: "utf8",
    timeout: 30_000,
  });
  const output = help.stdout + help.stderr;

  requireCondition(help.status === 2 && output.includes("Default Usage:"), "Unexpected storage CLI help behavior");
  const deployment = storageManifests(
    "probe",
    { accessKey: "A".repeat(24), secretKey: "B".repeat(48) },
    { accessKey: "C".repeat(24), secretKey: "D".repeat(48) },
  ).find((resource) => resource.kind === "Deployment");
  const spec = deployment?.spec as { template: { spec: { containers: { args: string[] }[] } } };

  for (const argument of spec.template.spec.containers[0].args.filter((value) => value.startsWith("-")))
    requireCondition(output.includes(argument.split("=")[0]), `Unsupported storage flag: ${argument.split("=")[0]}`);
  const velero = docker([...sandbox, "--entrypoint=/velero", IMAGES.velero, "install", "--help"]);

  for (const flag of [
    "--dry-run",
    "--output",
    "--namespace",
    "--use-node-agent",
    "--image",
    "--plugins",
    "--use-volume-snapshots",
    "--backup-location-config",
    "--secret-file",
  ])
    requireCondition(velero.includes(flag), `Missing installer flag: ${flag}`);
  const hosts = join(privateDirectory, "hosts");

  writeFileSync(hosts, KIND_HOSTS, { mode: 0o644 });
  chmodSync(hosts, 0o644);
  const resolved = docker([
    ...sandbox,
    "--mount",
    `type=bind,src=${hosts},dst=/etc/hosts,readonly`,
    "--entrypoint=getent",
    IMAGES.node,
    "hosts",
    "host.docker.internal",
  ]);

  requireCondition(
    resolved
      .trim()
      .split("\n")
      .every((line) => line.startsWith("198.18.64.1 ")),
    "Kind bootstrap host mapping failed",
  );
  console.log(
    "PASS: pinned storage/Velero CLI contracts and kind host mapping verified without network access. Cluster bootstrap remains a separate check.",
  );
}

async function installBuildTools(): Promise<void> {
  const state = join(homedir(), ".local", "state", "freelens-velero-dev");
  const tools = join(state, "tools");
  const bin = join(state, "bin");

  mkdirSync(tools, { recursive: true, mode: 0o700 });
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  const artifacts = [
    {
      name: "go.tar.gz",
      url: `https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz`,
      digest: "63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445",
    },
    {
      name: "kind",
      url: `https://github.com/kubernetes-sigs/kind/releases/download/v${KIND_VERSION}/kind-linux-amd64`,
      digest: "aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d",
    },
  ];

  for (const artifact of artifacts) {
    const response = await fetch(artifact.url, { signal: AbortSignal.timeout(180_000) });

    requireCondition(response.ok, "Public build-tool download failed");
    const bytes = Buffer.from(await response.arrayBuffer());

    requireCondition(
      createHash("sha256").update(bytes).digest("hex") === artifact.digest,
      "Build-tool checksum mismatch",
    );
    const temporary = join(privateDirectory, artifact.name);

    writeFileSync(temporary, bytes, { mode: 0o600 });
    if (artifact.name === "kind") {
      requireCondition(!existsSync(join(bin, "kind")), "Refusing to overwrite an existing private kind binary");
      renameSync(temporary, join(bin, "kind"));
      chmodSync(join(bin, "kind"), 0o700);
    } else {
      requireCondition(
        !existsSync(join(tools, `go${GO_VERSION}`)),
        "Refusing to overwrite an existing private Go toolchain",
      );
      execFileSync("tar", ["-xzf", temporary, "-C", privateDirectory], { env: environment, stdio: "pipe" });
      renameSync(join(privateDirectory, "go"), join(tools, `go${GO_VERSION}`));
    }
  }
  const kind = execFileSync(join(bin, "kind"), ["version"], { env: environment, encoding: "utf8" });
  const go = execFileSync(join(tools, `go${GO_VERSION}`, "bin", "go"), ["version"], {
    env: environment,
    encoding: "utf8",
  });

  requireCondition(
    kind.includes(`v${KIND_VERSION}`) && go.includes(`go${GO_VERSION}`),
    "Unexpected private tool version",
  );
  writeFileSync(join(tools, "provenance.json"), JSON.stringify(artifacts), { mode: 0o600 });
  console.log(
    `PASS: private Go ${GO_VERSION} and kind ${KIND_VERSION} installed from verified artifacts; global tools unchanged.`,
  );
}

async function installScanner(): Promise<void> {
  const bin = join(homedir(), ".local", "bin");
  const destination = join(bin, "trivy");

  requireCondition(!existsSync(destination), "Refusing to replace an existing scanner");
  const base = `https://github.com/aquasecurity/trivy/releases/download/v${SCANNER_VERSION}/`;
  const archiveName = `trivy_${SCANNER_VERSION}_Linux-64bit.tar.gz`;
  const checksums = await fetch(`${base}trivy_${SCANNER_VERSION}_checksums.txt`, {
    signal: AbortSignal.timeout(30_000),
  });

  requireCondition(checksums.ok, "Public scanner checksum download failed");
  const expected = (await checksums.text())
    .split("\n")
    .find((line) => line.trim().endsWith(archiveName))
    ?.trim()
    .split(/\s+/)[0];

  requireCondition(expected && /^[a-f0-9]{64}$/.test(expected), "Scanner checksum missing");
  const response = await fetch(`${base}${archiveName}`, { signal: AbortSignal.timeout(180_000) });

  requireCondition(response.ok, "Public scanner download failed");
  const archive = Buffer.from(await response.arrayBuffer());

  requireCondition(createHash("sha256").update(archive).digest("hex") === expected, "Scanner checksum mismatch");
  const file = join(privateDirectory, archiveName);

  writeFileSync(file, archive, { mode: 0o600 });
  execFileSync("tar", ["-xzf", file, "-C", privateDirectory, "trivy", "LICENSE"], { env: environment, stdio: "pipe" });
  const notices = join(homedir(), ".local", "share", "freelens-velero-dev", `trivy-${SCANNER_VERSION}`);

  mkdirSync(bin, { recursive: true });
  mkdirSync(notices, { recursive: true, mode: 0o700 });
  renameSync(join(privateDirectory, "trivy"), destination);
  chmodSync(destination, 0o755);
  renameSync(join(privateDirectory, "LICENSE"), join(notices, "LICENSE"));
  writeFileSync(
    join(notices, "release.json"),
    JSON.stringify({ version: SCANNER_VERSION, archive: `${base}${archiveName}`, sha256: expected }),
    { mode: 0o600 },
  );
  console.log(
    `PASS: Trivy ${SCANNER_VERSION} installed in user space; verified archive SHA256 ${expected}. No existing CLI replaced.`,
  );
}

try {
  const [action, ...extra] = process.argv.slice(2);

  requireCondition(
    action !== "install-scanner" && action !== "install-build-tools",
    "Retired by user directive: scanner and remediation-tool installation is disabled.",
  );
  requireCondition(
    ["pull", "probe", "install-scanner", "install-build-tools"].includes(action) && !extra.length,
    "Usage: node e2e/scripts/local-images.mts <pull|probe|install-scanner|install-build-tools>",
  );
  if (action === "pull") pull();
  else if (action === "probe") probe();
  else if (action === "install-build-tools") await installBuildTools();
  else await installScanner();
} catch (error) {
  const detail =
    error instanceof Error && "stderr" in error
      ? String(error.stderr).slice(0, 1000)
      : error instanceof Error
        ? error.message
        : "Image tooling failed";

  console.error(detail || "Isolated public-image command returned a nonzero exit code");
  process.exitCode = 1;
} finally {
  rmSync(privateDirectory, { recursive: true, force: true });
}
