import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_CLUSTER, DOCKER_HOST, localEnvironment, requireCondition } from "./local-kind.mts";
import { DIRECT_PROOF_IMAGE, IMAGES, KIND_HOSTS, storageManifests } from "./local-manifests.mts";
import {
  assertIndexPlatforms,
  type DockerInfo,
  dockerSocket,
  type EngineImage,
  engineIndex,
  type ImageIndex,
  type ImagePlatform,
  imageArchitecture,
  imagePlatform,
  verifiedPins,
} from "./local-platform.mts";

const privateDirectory = mkdtempSync(join(tmpdir(), "velero-image-tools-"));

function localDocker(): string {
  try {
    return dockerSocket(["/var/run/docker.sock", join(homedir(), ".docker", "run", "docker.sock")], (path) => {
      try {
        return statSync(path).isSocket();
      } catch {
        return false;
      }
    });
  } catch {
    return DOCKER_HOST;
  }
}

const dockerHost = localDocker();
const STATE = join(homedir(), ".local", "state", DEMO_CLUSTER);
const PINS = join(STATE, "pins.json");
const environment = {
  ...localEnvironment(process.env, "/dev/null", dockerHost),
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

// What the engine knows of an image, asked on its socket: the registry is not called.
function engineImage(image: string): Promise<EngineImage | undefined> {
  const name = encodeURIComponent(image.replace(/:[^:@/]+@/, "@"));

  return new Promise((resolve) => {
    const asked = request(
      { socketPath: dockerHost.replace(/^unix:\/\//, ""), path: `/images/${name}/json?manifests=1`, timeout: 30_000 },
      (response) => {
        const pieces: Buffer[] = [];

        response.on("data", (piece: Buffer) => pieces.push(piece));
        response.on("end", () => {
          try {
            resolve(
              response.statusCode === 200
                ? (JSON.parse(Buffer.concat(pieces).toString("utf8")) as EngineImage)
                : undefined,
            );
          } catch {
            resolve(undefined);
          }
        });
      },
    );

    asked.on("timeout", () => asked.destroy());
    asked.on("error", () => resolve(undefined));
    asked.end();
  });
}

function present(image: string, platform: ImagePlatform): boolean {
  const inspection = spawnSync("docker", ["image", "inspect", image], { env: environment, encoding: "utf8" });

  if (inspection.status !== 0) return false;
  const [inspected] = JSON.parse(inspection.stdout) as { Os: string; Architecture: string; RepoDigests: string[] }[];

  return (
    inspected.Os === "linux" &&
    inspected.Architecture === imageArchitecture(platform) &&
    inspected.RepoDigests.some((digest) => digest.endsWith(image.split("@")[1]))
  );
}

// The registry is asked only for what the machine does not have: an image that is here and a pin that was read stay.
async function pull(): Promise<void> {
  const platform = imagePlatform(JSON.parse(docker(["info", "--format", "{{json .}}"])) as DockerInfo);
  const verified = verifiedPins(existsSync(PINS) ? readFileSync(PINS, "utf8") : undefined);

  for (const [name, image] of Object.entries({ ...IMAGES, helper: DIRECT_PROOF_IMAGE })) {
    const pinned = image.split("@")[1];
    const here = present(image, platform);

    if (!verified.includes(pinned)) {
      const held = here ? engineIndex(pinned, await engineImage(image)) : undefined;

      assertIndexPlatforms(name, held ?? (JSON.parse(docker(["manifest", "inspect", image])) as ImageIndex));
      verified.push(pinned);
      mkdirSync(STATE, { recursive: true, mode: 0o700 });
      writeFileSync(PINS, JSON.stringify(verified), { mode: 0o600 });
    }
    if (!here) {
      docker(["pull", "--platform", platform, image]);
      requireCondition(present(image, platform), `Image identity mismatch: ${name}`);
    }
    console.log(`PASS: ${name} image matches its pinned digest on ${platform}.`);
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
  if (action === "pull") await pull();
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
