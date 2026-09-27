export const forbiddenAccesses: string[] = [];

function blockedNamespace(name: string): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        const access = `${name}.${String(property)}`;

        forbiddenAccesses.push(access);
        throw new Error(`Unexpected scaffold access: ${access}`);
      },
    },
  );
}

export class HostExtensionStub {
  clusterPages: unknown[] = [];
  clusterPageMenus: unknown[] = [];
  kubeObjectDetailItems: unknown[] = [];
  kubeObjectHandlers: unknown[] = [];

  activate(): void {
    this.onActivate();
  }

  disable(): void {
    this.onDeactivate();
  }

  protected onActivate(): void {
    return;
  }

  protected onDeactivate(): void {
    return;
  }
}

class MainExtensionStub extends HostExtensionStub {}
class RendererExtensionStub extends HostExtensionStub {}

class BlockedIpc {
  constructor() {
    forbiddenAccesses.push("Ipc.constructor");
    throw new Error("The scaffold must not register IPC handlers");
  }
}

export const Main = {
  LensExtension: MainExtensionStub,
  K8s: blockedNamespace("Main.K8s"),
  Catalog: blockedNamespace("Main.Catalog"),
  Ipc: BlockedIpc,
};

export const Renderer = {
  LensExtension: RendererExtensionStub,
  K8s: blockedNamespace("Renderer.K8s"),
  K8sApi: blockedNamespace("Renderer.K8sApi"),
  Catalog: blockedNamespace("Renderer.Catalog"),
  Ipc: BlockedIpc,
};

export const Common = blockedNamespace("Common");
