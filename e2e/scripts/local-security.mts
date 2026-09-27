import { requireCondition } from "./local-kind.mts";

export const IMAGE_NAMES = ["node", "velero", "plugin", "storage"] as const;
const OFFICIAL_REPOSITORIES = {
  node: "docker.io/kindest/node",
  velero: "docker.io/velero/velero",
  plugin: "docker.io/velero/velero-plugin-for-aws",
  storage: "docker.io/chrislusf/seaweedfs",
};

export function assertOfficialImages(images: Record<string, string>): void {
  requireCondition(Object.keys(images).length === IMAGE_NAMES.length, "Expected only the four official lab images");

  for (const name of IMAGE_NAMES) {
    const image = images[name];

    requireCondition(
      typeof image === "string" && image.startsWith(`${OFFICIAL_REPOSITORIES[name]}:`),
      `Image ${name} must come from its official upstream repository`,
    );
    requireCondition(
      /:[a-zA-Z0-9_.-]+@sha256:[a-f0-9]{64}$/.test(image),
      `Image ${name} requires an immutable release pin`,
    );
  }
}
