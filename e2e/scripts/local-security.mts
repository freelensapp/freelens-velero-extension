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

interface BinaryReport {
  version?: string;
  runs?: {
    tool?: { driver?: { name?: string } };
    results?: { ruleId?: string; level?: string }[];
  }[];
}

export function binaryReportHasNoCalls(text: string): boolean {
  const report = JSON.parse(text) as BinaryReport;

  requireCondition(
    report.version === "2.1.0" && Array.isArray(report.runs) && report.runs.length > 0,
    "Invalid binary scan report",
  );
  for (const run of report.runs) {
    requireCondition(
      run.tool?.driver?.name === "govulncheck" && (run.results === undefined || Array.isArray(run.results)),
      "Unexpected binary scanner output",
    );
    for (const result of run.results ?? []) {
      requireCondition(
        result.ruleId && (result.level === undefined || ["none", "note", "warning", "error"].includes(result.level)),
        "Invalid binary finding",
      );
    }
  }
  return report.runs.every((run) =>
    (run.results ?? []).every((finding) => finding.level === "note" || finding.level === "none"),
  );
}
