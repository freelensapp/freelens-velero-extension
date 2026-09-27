import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localEnvironment, requireCondition } from "./local-kind.mts";
import { IMAGES, KIND_HOSTS, storageManifests } from "./local-manifests.mts";

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

try {
  const [action, ...extra] = process.argv.slice(2);

  requireCondition(
    ["pull", "probe"].includes(action) && !extra.length,
    "Usage: node e2e/scripts/local-images.mts <pull|probe>",
  );
  if (action === "pull") pull();
  else probe();
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
