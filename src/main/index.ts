import { Main } from "@freelensapp/extensions";

export { DiagnosticKubernetes } from "./diagnostic-kubernetes";
export { DiagnosticService } from "./diagnostic-service";
export { DiagnosticError, downloadArtifact } from "./diagnostic-transport";
export { openPodTunnel } from "./diagnostic-tunnel";

export default class VeleroMain extends Main.LensExtension {}
