// What the activation of each process asks of the host: the store of the preferences in both processes, which
// the host writes from the main one; the way between the processes in both; and in the main process the
// procedures of the gate, registered and not called. Nothing of a cluster, and nothing of the catalog. The test
// of the entry points expects it of the sources, and the build test of the bundles: it is kept here, in a module
// that is not a test, so that neither runs the tests of the other.

export const ACTIVATION_CALLS = {
  main: [
    "ExtensionStore.loadExtension",
    "Ipc.constructor",
    "Ipc.handle gate.state",
    "Ipc.handle gate.enable",
    "Ipc.handle gate.disable",
    "Ipc.handle write.confirm",
    "Ipc.handle write.status",
    "Ipc.handle write.cancel",
    "Ipc.handle write.run",
    "Ipc.handle artifact.page",
    "Ipc.handle artifact.release",
    "Ipc.handle artifact.save",
    "Ipc.handle allowance.grant",
    "Ipc.handle allowance.revoke",
  ],
  renderer: ["ExtensionStore.loadExtension", "Ipc.constructor"],
} as const;
