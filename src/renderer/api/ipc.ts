// The way of the renderer to the main process: the procedures of the contract, each with its request
// and its answer read as the contract gives them. What the main process answers is not trusted: an
// answer that is not one of the contract is a failure of the way, never a value.

import { Renderer } from "@freelensapp/extensions";
import {
  type Answer,
  type ArtifactPage,
  type ArtifactTarget,
  type ArtifactValue,
  CHANNELS,
  failure,
  type GateState,
  readAnswer,
  readArtifactPage,
  readArtifactValue,
  readGateState,
  readServerStatusValue,
  readWriteConfirmAnswer,
  readWriteStatus,
  type ServerStatusValue,
  type WriteConfirmAnswer,
  type WriteKind,
  type WriteStatus,
  type WriteTarget,
} from "../../common/ipc";

import type { AllowanceFor } from "../../common/allowances";

// What the views ask of the gate, in the words of the contract.
export interface GateClient {
  state(cluster: string): Promise<Answer<GateState>>;
  enable(
    cluster: string,
    namespace: string,
    confirmation: { context: string; namespace: string },
  ): Promise<Answer<GateState>>;
  disable(cluster: string): Promise<Answer<GateState>>;
  onChanged(listener: (cluster: string) => void): () => void;
}

export interface WriteClient {
  confirm(
    cluster: string,
    namespace: string,
    kind: WriteKind,
    target?: WriteTarget,
    artifact?: ArtifactTarget,
  ): Promise<Answer<WriteConfirmAnswer>>;
  runServerStatus(
    cluster: string,
    namespace: string,
    token: string,
    request: string,
  ): Promise<Answer<ServerStatusValue>>;
  status(cluster: string, request: string): Promise<Answer<WriteStatus>>;
  cancel(cluster: string, request: string): Promise<Answer<null>>;
}

// What the views ask of an artifact of an operation: the download, with the token of its confirmation,
// then the text page by page, and that the main process lets the text go.
export interface ArtifactClient {
  runDownload(
    cluster: string,
    namespace: string,
    target: WriteTarget,
    artifact: ArtifactTarget,
    token: string,
    request: string,
  ): Promise<Answer<ArtifactValue>>;
  page(cluster: string, request: string, page: number): Promise<Answer<ArtifactPage>>;
  release(cluster: string, request: string): Promise<Answer<null>>;
}

// What the views ask of what the operator allows the downloads to do: to keep it, and to take it back.
export interface AllowanceClient {
  allow(cluster: string, allowed: AllowanceFor): Promise<Answer<null>>;
  takeBack(cluster: string, allowed: AllowanceFor): Promise<Answer<null>>;
}

const NO_ANSWER = failure("request-failed", "way", true, "The main process did not answer.");

export class VeleroIpcRenderer
  extends Renderer.Ipc
  implements GateClient, WriteClient, ArtifactClient, AllowanceClient
{
  // `bounded` says that the reader of the value bounds it itself: it is so for the page of a text, which
  // is larger than every other answer.
  private async ask<Value>(
    channel: string,
    request: unknown,
    read: (value: unknown) => Value | undefined,
    bounded = false,
  ): Promise<Answer<Value>> {
    let answer: unknown;

    try {
      answer = await this.invoke(channel, request);
    } catch {
      return NO_ANSWER;
    }
    return readAnswer(answer, read, bounded);
  }

  state(cluster: string): Promise<Answer<GateState>> {
    return this.ask(CHANNELS.gateState, { cluster }, readGateState);
  }

  enable(
    cluster: string,
    namespace: string,
    confirmation: { context: string; namespace: string },
  ): Promise<Answer<GateState>> {
    return this.ask(CHANNELS.gateEnable, { cluster, namespace, confirmation }, readGateState);
  }

  disable(cluster: string): Promise<Answer<GateState>> {
    return this.ask(CHANNELS.gateDisable, { cluster }, readGateState);
  }

  onChanged(listener: (cluster: string) => void): () => void {
    return this.listen(CHANNELS.gateChanged, (_event, payload: unknown) => {
      const cluster = (payload as { cluster?: unknown } | undefined)?.cluster;

      if (typeof cluster === "string") listener(cluster);
    });
  }

  confirm(
    cluster: string,
    namespace: string,
    kind: WriteKind,
    target?: WriteTarget,
    artifact?: ArtifactTarget,
  ): Promise<Answer<WriteConfirmAnswer>> {
    return this.ask(
      CHANNELS.writeConfirm,
      { cluster, namespace, kind, ...(target ? { target } : {}), ...(artifact ? { artifact } : {}) },
      readWriteConfirmAnswer,
    );
  }

  runServerStatus(
    cluster: string,
    namespace: string,
    token: string,
    request: string,
  ): Promise<Answer<ServerStatusValue>> {
    return this.ask(
      CHANNELS.writeRun,
      { cluster, namespace, kind: "ServerStatusRequest", token, request },
      readServerStatusValue,
    );
  }

  runDownload(
    cluster: string,
    namespace: string,
    target: WriteTarget,
    artifact: ArtifactTarget,
    token: string,
    request: string,
  ): Promise<Answer<ArtifactValue>> {
    return this.ask(
      CHANNELS.writeRun,
      { cluster, namespace, kind: "DownloadRequest", target, artifact, token, request },
      readArtifactValue,
    );
  }

  page(cluster: string, request: string, page: number): Promise<Answer<ArtifactPage>> {
    return this.ask(CHANNELS.artifactPage, { cluster, request, page }, readArtifactPage, true);
  }

  release(cluster: string, request: string): Promise<Answer<null>> {
    return this.ask(CHANNELS.artifactRelease, { cluster, request }, (value) => (value === null ? null : undefined));
  }

  allow(cluster: string, allowed: AllowanceFor): Promise<Answer<null>> {
    return this.ask(CHANNELS.allowanceGrant, { cluster, ...allowed }, (value) => (value === null ? null : undefined));
  }

  takeBack(cluster: string, allowed: AllowanceFor): Promise<Answer<null>> {
    return this.ask(CHANNELS.allowanceRevoke, { cluster, ...allowed }, (value) => (value === null ? null : undefined));
  }

  status(cluster: string, request: string): Promise<Answer<WriteStatus>> {
    return this.ask(CHANNELS.writeStatus, { cluster, request }, readWriteStatus);
  }

  cancel(cluster: string, request: string): Promise<Answer<null>> {
    return this.ask(CHANNELS.writeCancel, { cluster, request }, (value) => (value === null ? null : undefined));
  }
}
