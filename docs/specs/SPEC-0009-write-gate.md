# SPEC-0009: The Write Gate And The Way Between The Processes

- **Status:** Implemented
- **Date:** 2026-09-30
- **Milestone / tasks:** M3 / T4.1
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`; compared with v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`
- **Reviewed main:** `e5d9354ddf7607e0bad3ebc7744a4964c24b489a`, for the phase Failed of a DownloadRequest, which no release has
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [local foundation](SPEC-0001-local-foundation.md), whose T0.6 is the create-only adapter and the service this gate is enforced in; [target discovery](SPEC-0002-installation-discovery.md); the [architecture](../development/ARCHITECTURE.md#ipc-errors-and-write-policy)
- **Approval:** Approved by the lead maintainer on 2026-09-30, as drafted, with the open question of REQ-115 decided: the adapter runs the plugin a context names for its credential

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

No write of the extension reaches a cluster unless the operator turned writes on
for that cluster and that installation in this session, and confirmed the write
where it is offered; and it is the main process that refuses, whatever the views
ask of it.

## Scope Baseline

The writes of v1.0.0 are the creation of a DownloadRequest
([SPEC-0010](SPEC-0010-diagnostic-request-and-transport.md)) and of a
ServerStatusRequest ([SPEC-0012](SPEC-0012-server-status.md)) in this
milestone, and the actions of the fifth: a Backup, a Restore, a
DeleteBackupRequest, and the pause and the resume of a Schedule. This spec is
the gate they all pass, the way between the two processes of the extension, the
binding of the main process to the cluster of a frame, and the words. It changes
no view of the first two milestones but the target bar, which gets the state of
the gate and the command that changes it.

Excluded, with their owners: the operations themselves (their specs); the
approvals of the connections to the object store (SPEC-0010); the reviews the
actions of the fifth milestone add on top of this gate (their specs).

The facts of the host the design rests on were read in the source of the
validation target, in `packages/core/src`:

| Fact | Where |
| --- | --- |
| An extension of the main process declares a procedure the renderer calls with `Main.Ipc`, `handle(channel, handler)`, and a handler is called with the event of Electron, which names the frame that sent the request, and the arguments; it listens with `listen` and broadcasts with `broadcast`. The renderer calls with `Renderer.Ipc`, `invoke(channel, ...args)`, and listens with `listen` | `extensions/ipc/ipc-main.ts`, `extensions/ipc/ipc-renderer.ts` |
| Every channel of an extension is prefixed with the digest of the identifier of the extension: no extension shares a channel with another | `extensions/ipc/ipc-registrar.ts` |
| The result of a handler is copied by the host before it reaches the renderer, as plain data, and a handler that raises reaches the renderer as a rejection with the text of what was raised. A broadcast goes to every window and to every frame of a cluster: nothing the main process pushes is for one frame; only the answer of a call is | `common/ipc/ipc.ts` |
| A cluster is shown in a frame of its own, inside the one window of the application, whose address has the identifier of the cluster as the first label of its host, `<identifier>.renderer.freelens.app` in the packaged application; the frames have the integration of Node, so the IPC of the extension is there; the host tells the frames apart by their process and their frame identifiers | `renderer/components/cluster-manager/cluster-frame-handler.ts`, `common/utils/cluster-id-url-parsing.ts`, `main/start-main-application/lens-window/application-window/create-electron-window.injectable.ts`, `main/electron-app/runnables/setup-ipc-main-handlers/setup-ipc-main-handlers.ts` |
| In the main process the catalog gives every cluster with its identifier, its name, the path of its kubeconfig and the name of its context, as an observable list and not as events; in a frame the renderer knows the cluster the frame is of | `extensions/main-api/catalog.ts`, `extensions/common-api/cluster-types.ts`, `extensions/renderer-api/catalog.ts` |
| The host has a confirmation dialog that an extension opens with its own words | `extensions/renderer-api/components.ts` |

## User Scenarios

1. **P1, off by default:** Given a session that just started, when a tab that
   loads an artifact opens, then it says that writes are off for this
   installation, says what turning them on allows, and creates nothing.
2. **P1, turning writes on:** Given the target bar of an installation, when the
   operator asks to turn writes on, then a dialog names the cluster, its context
   and the namespace and the kinds this milestone creates, and after the
   confirmation the bar says that writes are on for that namespace of that
   cluster, on every page of the group.
3. **P1, each write confirmed where it is offered:** Given writes on, when the
   operator asks for the log of a backup, then the tab shows the exact object
   that will be created and asks for a second gesture; the request is created
   after it and not before, and a request the main process receives without
   that confirmation is refused.
4. **P1, the target changes:** Given writes on and a request in flight, when the
   operator selects another installation, then writes are off, the request is
   cancelled on this side, and what arrives late of it is not shown.
5. **P1, a request of another frame:** Given two clusters in the catalog, when a
   request that names the first arrives from the frame of the second, then it is
   refused, and the refusal is an answer with a code, not a raised text.
6. **P2, a connection the adapter does not take:** Given a cluster whose
   kubeconfig authenticates with a plugin the adapter does not run, when writes
   are turned on, then the tabs say that the diagnostics of this cluster are not
   available and why, and nothing is created.
7. **P2, refused by the API:** Given writes on and an identity that may not
   create the request, when the operator confirms, then the tab says that the
   cluster refused the creation, with what it needs, and writes stay on.
8. **P2, a new session:** Given writes on, when the application is started
   again, then writes are off.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-108 | Writes are off when the session starts, for every cluster. They are turned on for one cluster and one namespace at a time, in the main process, which refuses every write for another cluster, another namespace or while they are off, whatever the request says. The state the renderer shows is a mirror of the one of the main process, asked when a view opens and told at every change | GATE-01 |
| REQ-109 | Writes are turned on from the target bar, through the confirmation dialog of the host, whose words name the cluster, its context, the namespace and the kinds this milestone creates. They are turned off from the same place. The state is shown on every page of the group, with a mark and the words, and is never shown as on by a view that did not ask the main process | GATE-02 |
| REQ-110 | Every write is confirmed for one exact target. The view asks the main process for a confirmation of a cluster, a namespace, a kind of write, a name and a UID; the main process answers with a token bound to the frame that asked, good for thirty seconds and for one use, and runs the write only with that token, for that target, from that frame. At most 32 confirmations wait and 16 writes run at once for a cluster; a request beyond them is refused, not queued | GATE-03 |
| REQ-111 | A change of the selected namespace, a frame that goes, turning writes off and the deactivation of the extension turn writes off, clear the confirmations and abort the writes in flight of that cluster on this side. The renderer drops what arrives of a generation that is not the current one | GATE-04 |
| REQ-112 | Every request between the processes is a discriminated object, validated at run time in the process that receives it: every field of the kind and the form the contract gives it, names by the rules of the API, identifiers of the requests as UUIDs, the identifier of the cluster as the host writes it, a request of 64 KiB at most; a field that is not in the contract refuses the request. Every answer is a typed result: what was asked, or a code, the stage it failed at, whether it is safe to try again and words that are safe to show; a procedure never raises, since what is raised reaches the renderer as text. No raw error, no URL, no header, no body, no path of a file crosses between the processes, in either direction | GATE-05 |
| REQ-113 | The main process takes the identifier of the cluster from the address of the frame a request comes from, with the rule the host writes it by, and refuses a request that names another cluster, and one that does not come from the frame of a cluster. The key of a sender is that identifier with the process and the frame identifiers of the frame: every frame of the one window has its own. The binding is checked at every step of a write, not once. The result of a write is the answer of the call that ran it, and the state of a write in flight is read by the frame that asked, by its request identifier; nothing of a write is broadcast, and a frame cannot read or cancel what another asked | GATE-06 |
| REQ-114 | The main process resolves the cluster of a request from the catalog of the host, and takes the path of the kubeconfig and the name of the context from the entry of the catalog. An entry that is not there, a file that is not there or a context that is not in it refuse the request as a target that changed. No default kubeconfig, no current context of a file and no cluster the host shows are ever taken in their place. The adapter is one for each cluster, made when writes are turned on and discarded when they are turned off or the entry changes | GATE-07 |
| REQ-115 | The adapter takes a context that authenticates with a client certificate, a token, or a plugin that gives a credential, which it runs as the client of Kubernetes runs it for the command line: the command the context names, with the environment of the host, within thirty seconds; its output is read for the credential and is never logged, kept or sent between the processes. A plugin that fails, that does not answer in time or whose output is not a credential refuses the write as forbidden, with words that name the plugin and nothing of its output. A context that names an authentication provider, a proxy, a user name and a password, or turns the verification of TLS off is refused, and the tabs say which of these the connection of the cluster has and that the writes of the extension are not available for it | GATE-08 |
| REQ-116 | The identity of the cluster the adapter binds to is the entry of the context: the address of the server, its certificate authority and the credential of the user, read from the file before every request and compared with what was read when the adapter was made. A change of the entry refuses the request as a target that changed; a change elsewhere in the file, of another context, does not. The whole file is not the identity | GATE-09 |
| REQ-117 | Every command that writes says what it creates, with the name of the kind, and never "load" or "read" alone. The confirmation of a write shows the object as it will be submitted: its kind, its name or the prefix of its generated name, its namespace, its labels and its target | GATE-10 |
| REQ-118 | Nothing of the gate is kept between two sessions: the store of the preferences holds no enablement, no confirmation and no token | GATE-11 |
| REQ-119 | The gate is seen refusing in the packaged application: with writes off a command creates nothing, which the API server counts; with writes on and no confirmation nothing; with both, one object. A frame of a second entry of the catalog is refused for the first. An identity that may not create is refused by the API, and the state says so | GATE-12 |

## Design

- **Standard or ad hoc view, and why.** The gate is a state of the target bar,
  which every page of the group already has: the operator finds it where the
  installation is chosen, because it is a property of that choice. The dialog
  that turns writes on is the one of the host, which every operator of Freelens
  knows, with the words of this extension. The confirmation of one write is not
  a dialog: it is inline, in the tab or in the band that offers the write, so
  that the review of what will be created and its result are in the same place,
  and the second gesture is the one the token of REQ-110 stands for.
- **Safety.** This spec is the safety of every write of v1.0.0. The kinds it
  lets through in this milestone are DownloadRequest and ServerStatusRequest, and
  no other: a request that names another kind is refused as invalid before the
  gate is looked at. The tests prove the refusals, each seen failing when its
  guard is removed.

The main process, on activation, registers its procedures with `Main.Ipc` and
keeps one gate: for each cluster the namespace writes are on for, the time they
were turned on, the adapter of the cluster, and the confirmations. The
[service of the diagnostics](../../src/main/diagnostic-service.ts) of T0.6 keeps
its confirmation, its run and its cancellation, and is given the gate and the
binding from outside: what it knew as the enabled namespace is what the gate
says.

| Procedure | From the renderer | The main process answers |
| --- | --- | --- |
| `gate.state` | The cluster | Off, or on for a namespace since a time; and what the adapter says of the connection of the cluster |
| `gate.enable` | The cluster, the namespace and the words the dialog showed | On, or the reason it is not: the entry of the catalog, the file, the context, the connection |
| `gate.disable` | The cluster | Off |
| `write.confirm` | The cluster, the namespace, the kind of the write, the name and the UID of the target | A token, or a refusal |
| `write.run` | The cluster, the namespace, the kind, the target, the token and the identifier of the request | The result of the write, as its spec gives it, or a refusal |
| `write.status` | The cluster and the identifier of the request | The step the write is at, with what the step counts, for the frame that asked it; a refusal for another |
| `write.cancel` | The cluster and the identifier of the request | Nothing, or a refusal |
| `artifact.page` | The cluster, the identifier of the request, the page | One page of the text the main process holds for that frame, or a refusal |
| `artifact.release` | The cluster and the identifier of the request | Nothing: the text is let go |
| `artifact.save` | The cluster and the identifier of the request | The file was written where the operator chose, or was not chosen, or a refusal |

The main process broadcasts `gate.changed` with the cluster when the gate of a
cluster changes for a reason of its own: it watches the list of the clusters
the catalog gives, which is an observable value, and turns writes off when the
entry of a cluster goes or changes its file or its context. The frame of that
cluster asks the state again. Nothing else is broadcast: a broadcast reaches
every frame, and what a write does is for the frame that asked it.

The identifier of the cluster a request is bound to is read from the address of
the frame the event names, with the rule the host uses to write it: the first
label of the host, before `renderer.freelens.app` in the packaged application
and before `localhost` in development; the window of the host itself gives
none. The key of the sender in the service is that identifier with the process
and the frame identifiers of the frame, as a string, where the proof of T0.6
kept a number. A request whose cluster is another, or that comes from the
window of the host itself, is refused as forbidden. The identifier is checked
again before the object is submitted and before the result is given.

The [adapter](../../src/main/diagnostic-kubernetes.ts) of T0.6 is given the path
and the context from the entry of the catalog. Its check of the identity, which
compared the digest of the whole file at each step, compares the entry of the
context instead: the address of the server, its certificate authority and the
credential of the user, read from the file at each step. A file that another
tool rewrites for another context, as one that refreshes a token does, no longer
stops a write in flight for this one. The check runs on every request of the
adapter, as before.

In the renderer, the [state of an installation](../../src/renderer/state/installation.ts)
holds what the main process said of the gate, asked when the first view opens
and again at every broadcast. The target bar, after the selector of the
namespace, shows `Writes: off` and the command that turns them on, or
`Writes: on for <namespace>` with the time and the command that turns them off.
The command opens the confirmation dialog of the host with the words:

```text
Turn writes on for the installation velero-demo of the cluster local-demo
(context kind-local-demo)?

Until they are turned off, or another installation is selected, the extension
may create in that namespace the requests the views ask for on purpose: a
DownloadRequest for the log, the results, the resources or the volumes of an
operation, and a ServerStatusRequest for the version of the server. Each one is
confirmed where it is asked for. Nothing else is written.
```

These identifiers are synthetic. The tab of an artifact and the band of the
server show the state in words when writes are off, with the way to the target
bar, and with writes on show the command in the name of the kind, then the
inline confirmation with the object, then the result.

What the renderer sends and receives is typed in `src/common/ipc.ts`, with the
validation of each request and of each answer as pure functions, tested on both
sides: the main process validates what it receives, the renderer validates what
it receives, and neither trusts the other.

## Tests

Planned homes: unit tests of the gate, of the validation of the requests and of
the answers, of the reading of the identifier of a cluster from the address of a
frame, of the identity of a context in a file; tests of the main process with a
stub of `Main.Ipc` and a stub of the catalog; component tests of the target bar
and of the dialog; the suites of the views in the packaged application, with the
API server counting the creations. The demo gets a second entry in the catalog,
the kubeconfig of the reader of the views, whose frame is the other frame of
GATE-06.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| GATE-01 | Unit/packaged | REQ-108 | Off at start; on for one namespace refuses another namespace and another cluster; the mirror of the renderer follows what the main process answered, never a local guess |
| GATE-02 | Component/packaged | REQ-109 | The command opens the dialog with the cluster, the context and the namespace in its words; the state after the confirmation on every page of the group; turned off from the bar |
| GATE-03 | Unit/packaged | REQ-110 | A token for one target, used once, expired after thirty seconds on a fake clock, refused for another target, another frame and another kind; the 33rd confirmation and the 17th write of a cluster refused |
| GATE-04 | Unit/component/packaged | REQ-111 | A change of namespace with a write in flight: the write is cancelled, the confirmations cleared, the late answer not shown; the frame gone; the deactivation |
| GATE-05 | Unit | REQ-112 | Every field of every request with a wrong kind, a wrong form, an extra field, a request too large; every procedure answering a result and none raising, on every way of failing; the answers of every code without a URL, a header, a body or a path, checked with a sentinel |
| GATE-06 | Unit/packaged | REQ-113 | The identifier read from the addresses the host writes, of the packaged application and of development; a request from the window; two frames of one window with their own keys; in the packaged application the frame of the second entry asking for the first, and reading or cancelling a write of the first: refused, and nothing of the write seen there |
| GATE-07 | Unit | REQ-114 | An entry that is not there, a file that is not there, a context that is not in it; the adapter made once for a cluster and discarded when writes are turned off; no default kubeconfig read, proven with a home directory that holds one |
| GATE-08 | Unit | REQ-115 | A context of each refused form, and the words of each; a certificate, a token and a plugin accepted, the plugin a script of the test that gives a credential; a plugin that fails, one that does not answer in thirty seconds on a fake clock, one whose output is not a credential: forbidden, with nothing of the output in the answer, checked with a sentinel in it |
| GATE-09 | Unit | REQ-116 | The entry of the context changed in the file between two steps: refused; another context changed: not; a token of another context refreshed while a write polls: the write ends |
| GATE-10 | Component | REQ-117 | Every command that writes names its kind; the confirmation shows the object; no command says "load" alone |
| GATE-11 | Packaged | REQ-118 | Writes on, the application closed and started again: off; the store of the preferences without a field of the gate |
| GATE-12 | Packaged | REQ-119 | The counts of the API server for the creations of DownloadRequest: none with writes off, none without confirmation, one with both; the identity without the permission refused by the API and the state that says so |

## Success Criteria

All 12 checks pass before this spec is Verified. No write is created in the
packaged application without the two gestures, and none for a cluster or a
namespace other than the one the gesture named.

Manual review: on the demo, turn writes on, ask for the log of the real backup,
confirm, then select another installation. Expected: the dialog names what it
should, the confirmation shows the object, the log arrives, and after the change
of installation writes are off and the tab is back to its first state. Record
role, date and verdict.

## Assumptions And Decisions

- **The gate is per installation, not per cluster.** Writes on for one namespace
  say nothing of another namespace of the same cluster: an operator who looks at
  two installations turns writes on for each. It is the scope the
  [directives](../../AGENTS.md#cluster-and-data-safety) give.
- **No time limit in this milestone.** Writes stay on until they are turned off
  or the target changes, for the session. The actions of the fifth milestone may
  add a limit of time: the confirmation of each write is what makes a forgotten
  gate harmless.
- **The confirmation of a write is inline.** A dialog for every log would be in
  the way of the operator and would teach to click through it. The inline review
  keeps the object under the eyes and the result under the review.
- **The identity of a context, not of a file.** The proof of T0.6 took the whole
  file as the identity, which stopped a write when another context of the same
  file changed: a file shared by many clusters is the common layout.
- **Plugins for the credential, decided at approval.** The proof of T0.6 refused
  a context that runs a plugin for its credential, which is what the managed
  clusters of the cloud providers and the ones with OpenID Connect use. The
  host runs that same plugin for that same cluster, through its proxy, every
  time a view reads. The spec proposed two ways: the adapter runs the plugin
  the context names, as the client of Kubernetes does for the command line,
  with the environment of the host, a bound of thirty seconds, and nothing of
  its output ever logged or sent between the processes, keeping the refusal of
  a proxy, of a user name with a password and of a verification of TLS turned
  off; or the diagnostics left off for those clusters in v1.0.0. The lead
  maintainer chose the first on 2026-09-30: it is what REQ-115 says.

## Evidence And Deviations

Approved on 2026-09-30, as drafted, with the decision above, and implemented by
2026-10-02, after an independent review of the first implementation, whose findings
are in the code and in its tests. The [gate](../../src/main/write-gate.ts), the
[procedures](../../src/main/ipc.ts), the [contract](../../src/common/ipc.ts), the
[rule of the frame](../../src/common/frame.ts) and the
[identity of a context](../../src/main/context-identity.ts) are what the
[architecture](../development/ARCHITECTURE.md#the-gate-and-the-way-between-the-processes)
describes; the [target bar](../../src/renderer/components/target-bar.tsx) shows the
state and opens the dialog of the host; the
[state of an installation](../../src/renderer/state/installation.ts) holds the mirror
and turns writes off when the namespace changes.

| Check | Evidence |
| --- | --- |
| GATE-01 | Unit: off at the start, on for one namespace refuses another and another cluster. Packaged: off when the session starts, on every page of the group; the mirror of the views is what the main process answered |
| GATE-02 | Component: the dialog with the installation, the cluster and the context in its words; nothing on before it is answered. Packaged: the dialog of the host, its words, the state after it on every page, off from the bar, off when the dialog is left |
| GATE-03 | Unit: a token for one target, one sender, one use, thirty seconds on a fake clock; the 33rd confirmation and the 17th write of a cluster refused |
| GATE-04 | Unit: a change of namespace with a write in flight aborts it and clears the confirmations; the entry gone; the deactivation. The frame that turned writes on gone, found on a request and when the catalog is looked at, and a frame that cannot be asked taken as gone; a write whose frame is another at the creation, goes while the write waits, or goes before its result. State: the mirror off at once and the main process told whatever the mirror said; a confirmation of a write that is shown, or still asked, left when the gate goes off, and the gate asked again after a write that failed. Packaged: off when another installation is selected; a frame that goes is not proven in the packaged application |
| GATE-05 | Unit: every field of every request with a wrong kind, a wrong form, an extra field, a request too large; every procedure answering a result, one that raises among them; every code without a URL, a header, a body or a path, with a sentinel |
| GATE-06 | Unit: the identifier from the addresses of the packaged application and of development, the window, a frame of another cluster, the key of each frame. Packaged: two frames of one window, the second entry of the catalog under a context of another name, each with a gate of its own |
| GATE-07 | Unit: an entry that is not there, a file that is not there, a context that is not in it; the adapter made once when writes are turned on and discarded when they are turned off; a connection the adapter does not take refuses to turn writes on, with its reason, which the state keeps. The catalog is the one of the host: no default kubeconfig is read, which the activation tests prove |
| GATE-08 | Unit: a context of each refused form and the words of each; a certificate, a token and a plugin accepted, the plugin a script of the test; a plugin that fails, one that ignores the request to end and is killed at its bound, one whose output is not a credential, each a real command and each said as a failure of the plugin, by the name of its command, with nothing of its output; a write cancelled while its plugin runs; one run for the requests that wait together, and another after a 401; the user a context impersonates sent with a token and with a plugin, and groups, a uid or extra fields refused; a certificate a plugin gives presented to the server; a real plugin against the API fixture, with the token it gives and with a wrong one |
| GATE-09 | Unit: the entry of the context changed in the file between two steps refuses the request; another context changed, and a byte of the file, do not; the user it impersonates is part of what is compared |
| GATE-10 | Component: the command in the name of the kind, the dialog with the object of the gate. The confirmation of one write, inline in the band of the server: the kind, the prefix of the generated name, the namespace, the cluster and its context, the labels, the spec and the target, which are what the API server of a test is then sent through both processes; every command of the band names what it creates or leads to the target bar, and none loads or reads alone. Packaged: the confirmation on the demo, reached and left with the keyboard alone |
| GATE-11 | Packaged: writes on, the application closed and started again, off; the store of the preferences without a field of the gate |
| GATE-12 | Packaged: no write counted by the API server through the whole suite of the gate, with the gate off and on. In the suite of the band of the server: nothing counted with writes off, nothing with writes on and no confirmation, one creation with both; the identity without the permission refused by the cluster, with the words of the band and writes left on. The API server does not count a creation it refuses to the identity: none is counted, and no request is in the namespace |

What was decided while implementing, inside the requirements:

- **The state of the gate carries the name of the cluster and its context**, as the
  catalog of the host gives them, so that the dialog names them without a read of its
  own.
- **The catalog is looked at every five seconds while writes are on somewhere**, and
  not before: the list the host gives is an observable value, and the poll asks
  nothing of a cluster. Nothing of the catalog is read at activation.
- **The run of a ServerStatusRequest is in this slice**, as the smallest write and the
  proof of the way between the processes end to end: its band in the Overview comes
  with its own spec. The run of a DownloadRequest answers that it comes with a later
  slice, before the gate is looked at.
- **The frame of a second entry is a second entry of the catalog**, the same cluster
  through another kubeconfig under a context of another name: it is what a window
  with two clusters is, and the packaged suite opens both.
- **A frame that goes is found by asking the event that turned writes on for its
  frame again**: the host answers none, or raises, for a frame that was disposed, and
  another address for one that left the cluster. It is asked on every request of
  the cluster and every five seconds, and four times a second by a write in flight.
- **Turning writes on is refused for a connection the adapter does not take**, as the
  table of the procedures says, with the words of the reason; a file or a context
  that is not there is a target that changed. Two reasons were added to the ones of
  the connection: an impersonation the client cannot send, and an adapter that
  cannot be made.
- **A plugin that gives no credential is a failed request at the stage of the
  credential**, safe to ask again, and not a code of its own: the words name the
  file of the command, never its folder, its arguments or what it printed.
- **A command a plugin starts is not killed with it**: the bound ends the wait and
  kills the command the context names; what that command started is left to it.

Left for the slice of the DownloadRequest, where they are first used: the kind of the
artifact as a part of what a confirmation is for, and the service of the diagnostics
given the gate in place of its own enablement.

