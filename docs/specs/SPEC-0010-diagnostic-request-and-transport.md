# SPEC-0010: The Diagnostic Request And Its Transport

- **Status:** Approved
- **Date:** 2026-09-30
- **Milestone / tasks:** M3 / T2.1, T2.2, T2.4, each its own slice
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`; compared with v1.18.4, `4ee1e79a7aed367fd9b767b8219ec65bd0c96892`; reviewed AWS plugin v1.14.2, `5463822fd77bc1c2a1151ee76c830ad979ff2781`
- **Reviewed main:** `e5d9354ddf7607e0bad3ebc7744a4964c24b489a`, for the phase Failed of a DownloadRequest, which no release has
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [local foundation](SPEC-0001-local-foundation.md), whose T0.6 is the service, the adapter, the transport and the tunnel this spec wires to the host; [the write gate](SPEC-0009-write-gate.md); [states and Backups](SPEC-0003-backup-read-only.md); [Restores](SPEC-0005-restore-read-only.md); [locations](SPEC-0007-locations-read-only.md)
- **Approval:** Approved by the lead maintainer on 2026-09-30, as drafted

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

The log, the results, the resource list and the volume information of a backup
or of a restore reach the operator from the object store of the installation
through the main process: one DownloadRequest the operator asked for, a signed
URL that never leaves the main process, a destination that is checked before a
byte is sent, bytes and time that are bounded, and every way it can fail told
apart from the others.

## Scope Baseline

The API of the reviewed release has fourteen kinds of download target. Eight are
what v1.0.0 shows: BackupLog, RestoreLog, BackupResults, RestoreResults,
BackupResourceList, RestoreResourceList, BackupVolumeInfos and RestoreVolumeInfo.
BackupContents is never offered, as the [directives](../../AGENTS.md#cluster-and-data-safety)
say; the five others, the snapshots and the operations of the items and the CSI
objects, are not in the agreed scope. The
[recon](../development/RECON-T0.1.md#start-of-the-third-milestone-2026-09-30)
holds the facts of the reviewed release this spec rests on: how a request is
processed and when it is not, how long a URL lasts, what is written into the
store and when, how the plugin signs and how the bucket is addressed.

Included: T2.1, the service of the request wired to the gate and to the host;
T2.2, the transport, its bounds, its trust and its redaction; T2.4, the route:
which origin is trusted, which path, which address, when a tunnel to the pod of
the storage is opened, and what the operator approves once. The defects the
proof of T0.6 left in this code are closed here, one by one, with a test each.

Excluded, with their owners: what is shown of an artifact
([SPEC-0011](SPEC-0011-artifact-viewers.md)); the gate itself (SPEC-0009); a
verification of TLS turned off, which v1.0.0 does not offer.

## User Scenarios

1. **P1, the log of the real backup, through the cluster:** Given the demo, whose
   storage is a Service inside the cluster, when the operator confirms the log
   of the backup the controller ran, then a DownloadRequest is created, a URL is
   signed, a tunnel to the pod of the storage is opened, the log arrives, and
   the tab says by which way.
2. **P1, an artifact Velero never wrote:** Given a backup that failed its
   validation for its selectors, when its log is asked, then a URL is signed,
   the store answers that there is no such file, and the tab says that Velero
   writes nothing for an operation that failed its validation, which is not a
   fault of the storage.
3. **P1, no URL:** Given an installation whose server is stopped, or whose
   storage location the server cannot open, when a log is asked, then after
   thirty seconds the tab says that Velero did not sign a URL, what it may
   mean, and that the request stays until Velero removes it.
4. **P1, nothing to ask for:** Given a restore Velero refused because its
   schedule has no completed backup, or a backup whose storage location is not
   there, when a log is asked, then the tab says so before any request is
   created: Velero would sign no URL for them.
5. **P1, a store outside the cluster:** Given a storage location on a public
   endpoint, when a log is asked, then the origin and the path of the URL are
   checked against the location and its bucket, the name is resolved on this
   machine, the address is checked, and the connection is made to that address
   with the host and the server name of the URL, over TLS verified by the trust
   of the host.
6. **P1, a store with its own certificate:** Given a location that names a
   Secret for its certificate, when a log is asked, then the main process reads
   that key of that Secret and no other, and a Secret the identity may not read
   ends in a state that says so, with no connection made without verification.
7. **P1, cancellation:** Given a download in flight, when the operator cancels,
   then the connection, the tunnel and the polling end on this side, nothing is
   shown, and the tab says that the request stays until Velero removes it.
8. **P2, too large:** Given an artifact beyond the bounds, when it is
   downloaded, then the operation ends with a state that says so and shows
   nothing of it.
9. **P2, refused at a step:** Given an identity that may create the request but
   not read the Service of the storage, when a log is asked, then the tab says
   which read was refused and what the tunnel needs.
10. **P2, an origin that is none of the known:** Given a location of a provider
    the extension has no rule for, when a log is asked, then the tab asks the
    operator to allow downloads from that origin for that location, once, and
    remembers it.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-120 | The main process creates a DownloadRequest for the eight kinds above and refuses every other, BackupContents first, whatever the request says, before the gate is looked at | DIAG-01 |
| REQ-121 | The way of a request is: the confirmation of the gate; the target read again by name and UID; its backup, for a restore; the storage location of the backup; its certificate; the creation; the polling for a URL; the route; the download; the delivery to the renderer, in pages; the release of what was opened. A restore that names no backup, and a backup whose storage location is not there, end as not-found at that step, before any creation: the controller of the release signs no URL for them. Nothing is fetched before the confirmation, on a hover, a selection, a read or the opening of a view. A request with the identifier of one in flight joins it; a second command creates a second request, which is a second write the operator asked for | DIAG-02 |
| REQ-122 | The request is named `<name of the target>-<identifier of the request>`, carries the label `freelensapp.io/diagnostic-request` with that identifier and the label that names the extension, and is read back by name, namespace, UID, label and target before any value of it is used. A URL is taken from no object that is not that request | DIAG-03 |
| REQ-123 | The request is read every 250 milliseconds, for thirty seconds at most, until it carries a URL; the whole operation ends in 120 seconds. A request the controller could not process carries no phase, which the release reads as New, and no URL: the wait is the only exit. An expiration of the request that has passed, and a phase Failed, which the main branch of Velero has and the release does not, end the wait | DIAG-04 |
| REQ-124 | Every way the operation ends is a code with a stage, whether it is safe to try again, and words: cancelled; deadline (no URL in time, with what it may mean); request-failed; artifact-missing (the store has no such file); not-found (the target, the backup of a restore or the storage location is not there, with which); target-changed; forbidden (which read or creation the API refused); conflict (a request of that name exists and is not this one; the existing one is kept); submission-unknown (the creation may have happened, with the name to look for); tls-invalid; destination-denied (with the rule); transport-unreachable; payload-too-large; artifact-invalid. No two of these are folded into one, and a handler never raises: every end is an answer | DIAG-05 |
| REQ-125 | A file the store does not have is told from a store that could not be reached and from a URL that was not signed: a 404 of the store is artifact-missing, a refused or failed connection is transport-unreachable or tls-invalid, no URL is deadline. The words of what a missing file means for the phase of the target are the ones of SPEC-0011 | DIAG-06 |
| REQ-126 | The origin of the signed URL must be one the location gives. With `publicUrl` set, or else `s3Url` set: that origin, or, when `s3ForcePathStyle` is not true, the same scheme and port with the host `<bucket>.<host of that URL>`, which is how the SDK of the plugin addresses a bucket the plugin does not force into the path. With neither and the provider of AWS: HTTPS, a host under `amazonaws.com` or `amazonaws.com.cn` on a boundary of its labels, and the bucket as the first label of the host or the first segment of the path; the hosts of the other partitions are not known and go to the allowance. Any other origin is allowed only after the operator allowed it for that cluster, that location and that origin, in words that show the origin. A URL with user information, a fragment, or a scheme that is not HTTP or HTTPS is refused | DIAG-07 |
| REQ-127 | The path of the signed URL must be the key of the target in the layout of the store: `/<prefix>/<key>` when the bucket is in the host, `/<bucket>/<prefix>/<key>` when it is in the path, the prefix being the one of the location, empty or not. The log of a backup is asked and nothing else is fetched with its URL | DIAG-08 |
| REQ-128 | A host name that is not of a Service of the cluster is resolved on this machine, once; every address it resolves to is checked in its canonical form, and the connection is made to the first that is allowed, with the host and the server name of the URL. Unspecified, link-local, multicast, the addresses of the metadata services of the clouds, `169.254.0.0/16`, `fe80::/10`, `fd00:ec2::/32`, `168.63.129.16` and the name `metadata.google.internal`, and loopback outside a tunnel are refused, with or without an allowance. A private address, of `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `198.18.0.0/15` or `fc00::/7`, is allowed only after the operator allowed it for that cluster and that origin | DIAG-09 |
| REQ-129 | A host name of the form `<name>.<namespace>.svc`, with or without the domain of the cluster after it, is a Service of the cluster and is never resolved on this machine. A bare `<name>`, or `<name>.<namespace>`, is a Service when one of that name is in that namespace or in the one of the installation, and is refused as ambiguous when it resolves on this machine as well. A Service is reached through a tunnel: the Service is read, the port of the URL matched to one of its ports and followed to its target port, by number or by name; the endpoint slices of the Service read, one address that is ready and names a Pod chosen; the Pod read and checked ready, with the container port the target port names; and a port-forward the extension opens through the API server to that Pod, with the identity of the kubeconfig. The listener is on the loopback of this machine, for one connection, and is closed with the operation. The host, the path, the query and the server name of the URL are kept; only the socket changes destination. A Service without a ready endpoint, a port that is not one of its, or a Pod without that port end as destination-denied with the reason | DIAG-10 |
| REQ-130 | Plain HTTP directly from this machine is allowed only after the operator allowed it for that cluster and that origin, and the state says that the connection is not encrypted. Plain HTTP through the tunnel is allowed, and the state says that the bytes travel inside the connection to the API server and inside the cluster. No download ever falls back from HTTPS to HTTP | DIAG-11 |
| REQ-131 | TLS is verified with the certificates the host trusts, the ones of the runtime and of the system, and the certificate of the location: the key of the Secret the reference names first, read in the main process, in the namespace of the location, and discarded after; the inline one only when there is no reference, as the release does. The key `insecureSkipTLSVerify` of the location is not honored, and the state says so when the verification fails. A Secret the identity may not read, a key that is not in it, a value that is not a certificate end as tls-invalid, and no connection is made without verification | DIAG-12 |
| REQ-132 | What the operator allows, an origin, a private address, plain HTTP, is kept in the store of the preferences for that cluster and that origin, with the time, shown in the target bar under the connections, and taken back from there. It is asked in the tab, in words that show the origin, and never assumed; it holds no credential and no URL | DIAG-13 |
| REQ-133 | The bounds are 16 MiB of compressed bytes and 64 MiB decompressed, ten seconds to connect, fifteen of silence, 120 for the whole operation; two operations run at once in the process, the others wait and can be cancelled while they wait. A bound that is reached ends the operation with payload-too-large or deadline and delivers nothing of it. The decoded text is held by the main process for the view that asked it, given to the renderer in pages of 4 MiB at most, and released when the view lets it go or after ten minutes: one copy in each process at most. Cancellation and the end of an operation close the connection, the decoder, the tunnel and its listener; a route that does not close in five seconds is reported as such and does not hold a slot | DIAG-14 |
| REQ-134 | The signed URL, its query, the headers, the bodies of the answers of the API and of the store, and the paths of files appear in no result, no error, no message between the processes, no log of the console and no test report. A sentinel of the URL is looked for in every one of them | DIAG-15 |
| REQ-135 | The main process deletes no request. The controller writes an expiration ten minutes ahead when it takes the request, and again when it signs the URL, and removes the request at its next pass after that, within a minute; a request the server never saw carries no expiration and stays. The state says so. A creation whose answer was lost is reconciled by reading the request by its name; a second creation is never sent for it, and a request that cannot be found ends as submission-unknown with the name | DIAG-16 |
| REQ-136 | What the proof of T0.6 left is closed, each with a test seen failing before the change: a creation refused before the connection is transport-unreachable and not an unknown submission; the trust is the one of the host; an API server at an IPv6 address; the rules on the addresses in canonical form, with the two metadata addresses above; the label of the name of a backup cut as Velero cuts it; one keep-alive agent for each adapter; the identity of the context of SPEC-0009; a field that is not a string refused; the close of a route bounded; a listener with a handler of its errors; a synchronous failure of a request turned into a code; every code of a TLS failure; a URL with the port of its scheme or a host in capitals; a location with both certificates, of which the reference wins; the endpoint slices in place of the endpoints; the key of a sender as SPEC-0009 defines it | DIAG-17 |
| REQ-137 | The proof of T0.6 stays green in the four modes it has, HTTP through the tunnel, HTTPS through the tunnel with the inline and with the referenced certificate, direct HTTPS with the referenced certificate. The packaged application downloads the four artifacts of the real backup and of the real restore of the demo through the tunnel, and the artifacts of a backup synced from the store; the identities of the demo end as forbidden at the step each may not do: the creation of the request, the read of the Secret, the read of the Service, the port-forward. The permissions the tunnel needs beside the kinds of Velero, `get` on services and pods, `list` on endpointslices, `create` on `pods/portforward`, are the ones the documentation of v1.0.0 lists | DIAG-18 |

## Design

- **Standard or ad hoc view, and why.** Nothing of this spec is a view: it is the
  service of the main process the tabs of SPEC-0011 ask, through the gate of
  SPEC-0009. What the operator sees of it is the state of a tab, the inline
  confirmation and the words of each way it ends.
- **Safety.** The only write to the cluster is the DownloadRequest, through the
  gate. The main process reads the target, its backup, its location, the Secret
  of the certificate when the location names one, and for the tunnel the
  Service, its endpoint slices and the Pod of the storage, and opens a
  port-forward to that Pod through the API server. The identity is the one of
  the kubeconfig of the cluster in the catalog of the host, with the
  permissions it has: what it may not do ends as forbidden with the step. The
  suites count on the API server what was created and what was read.

The [service](../../src/main/diagnostic-service.ts), the
[adapter](../../src/main/diagnostic-kubernetes.ts), the
[transport](../../src/main/diagnostic-transport.ts) and the
[tunnel](../../src/main/diagnostic-tunnel.ts) of T0.6 stay what they are, with
the changes of REQ-136 and with the route given by a resolver of the main
process, which the proof of T0.6 gave from its script. The resolver, in
`src/main/diagnostic-route.ts`, decides from the URL and the location:

| Step | Rule | Where it is decided |
| --- | --- | --- |
| Origin | REQ-126, from `spec.provider` and `spec.config` of the location, its bucket, and what the operator allowed | Pure function in `src/common/artifact-origin.ts`, tested on plain data |
| Path | REQ-127, from the target, the bucket, the prefix and where the bucket is | The same |
| Host name | A Service of the cluster or a name of this machine, by REQ-129 | The same, with the reads of the adapter for the Service |
| Address | REQ-128, from the addresses resolved, in canonical form | Pure function on the addresses, `src/common/artifact-address.ts` |
| Scheme | REQ-130 | The same |
| Trust | REQ-131 | The adapter, for the Secret; the transport, for the connection |

The result the main process gives to the renderer is the size of the decoded
text, the identity of the request, and the route in words: the mode, tunnel or
direct, whether the connection was encrypted, and the origin; then the pages of
the text as the renderer asks for them. The URL is in none of it.

The approvals of REQ-132 are a map of the store of the preferences, for each
cluster, from an origin to what was allowed and when. The target bar lists them
under the connections of the installation, each with the command that takes it
back; the tab that needs one asks for it with the origin in its words and the
command that allows it, and asks the main process again after.

The words of the states, by code and stage, are in
`src/common/diagnostic-text.ts`, one function, so that the tabs of SPEC-0011 and
the band of SPEC-0012 say the same thing of the same failure.

The proof of T0.6 keeps its script and its four modes as the test of the main
process against the real controller and the real store, outside the host. The
suites of the views add what the host adds: the frame, the gate, the identities.

## Tests

Planned homes: unit tests of the origin, the path, the address and the scheme
rules on plain data; the tests of the service, of the adapter, of the transport
and of the tunnel of T0.6, extended for each item of REQ-136; the transport
proof of the environment, `pnpm e2e`; the suites of the views in the packaged
application. Fixtures: the real backup and the real restore of the demo; the
backup synced from the store of SPEC-0011; a backup and a restore in the
namespace of the installation that fail their validation for naming both kinds
of selector, which keeps their backup and their location valid so that a URL
is signed and the store is reached; a restore asked from a schedule that has
no backup, which Velero refuses without a backup name; a third identity that
may create requests and read the kinds of Velero, and not the Service of the
storage; the existing identity that reads and may not create.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| DIAG-01 | Unit | REQ-120 | Each of the eight kinds accepted; BackupContents and the five others refused as invalid, before the gate |
| DIAG-02 | Unit/packaged | REQ-121 | The steps in order on a fake adapter; a restore without a backup name and a backup without its location end before the creation; the reads the API server counts in the packaged application: none before the confirmation, the reads of the way after |
| DIAG-03 | Unit/proof | REQ-122 | The name and the labels of the created object; a request of the same name and another UID or label refused as target-changed |
| DIAG-04 | Fake-clock unit | REQ-123 | 250 ms, thirty seconds, 120 seconds; a request without a phase and without a URL for thirty seconds; an expiration passed; a phase Failed |
| DIAG-05 | Unit | REQ-124 | Each code with its stage, its retry safety and its words; no two ways ending in the same code; every handler answering and none raising |
| DIAG-06 | Unit/proof/packaged | REQ-125 | A 404 of the store, a refused connection, a wrong certificate, no URL: four codes; in the packaged application the backup and the restore that failed their validation for their selectors end as artifact-missing |
| DIAG-07 | Unit/packaged | REQ-126 | `publicUrl` set and the URL of `s3Url`: refused; `s3Url` with the bucket in the path and in the host, by the value of `s3ForcePathStyle`; the provider of AWS with neither, a host under the two domains with the bucket in the host and in the path, a host of another partition, a host that merely ends with the letters of the domain; another provider without an allowance; user information, a fragment, another scheme |
| DIAG-08 | Unit | REQ-127 | The key of each of the eight kinds, with and without a prefix, with the bucket in the host and in the path; a URL of another key of the same backup refused |
| DIAG-09 | Unit | REQ-128 | Each refused range in IPv4 and IPv6, in every written form, and the two metadata addresses with an allowance; a private address with and without an allowance; two addresses of which the first is refused; the socket connected to the address and not to the name |
| DIAG-10 | Unit/proof/packaged | REQ-129 | The forms of the name, a `.svc` name never resolved, a bare name that is both; the Service, a port followed to a target port by number and by name, its endpoint slices, the ready address, the Pod; no ready endpoint, a wrong port, a Pod without the port; the listener closed with the operation; the proof through the tunnel with the host and the server name kept |
| DIAG-11 | Unit/proof | REQ-130 | Direct HTTP without an allowance refused, with one allowed and said; HTTP through the tunnel allowed and said; no downgrade from HTTPS |
| DIAG-12 | Unit/proof/packaged | REQ-131 | The trust of the host plus the certificate; the referenced certificate, the inline one, both with the reference winning; the key that is not there, the Secret refused to the identity, a value that is not a certificate; `insecureSkipTLSVerify` in the location and the verification kept |
| DIAG-13 | Unit/component/packaged | REQ-132 | An allowance asked, given, kept between two starts, shown, taken back; none assumed; the store without a URL or a credential |
| DIAG-14 | Unit | REQ-133 | Each bound reached; the third operation waiting and cancelled; the pages of a text of 64 MiB and their release; every socket, decoder, tunnel and listener closed after each way of ending; a route that does not close |
| DIAG-15 | Unit/proof/packaged | REQ-134 | A sentinel in the URL looked for in every result, error, message, console line and report of the suites |
| DIAG-16 | Unit/proof | REQ-135 | No delete sent, ever; an answer lost then the request found by name; not found: submission-unknown with the name |
| DIAG-17 | Unit | REQ-136 | One test for each item, seen failing on the code of T0.6 |
| DIAG-18 | Proof/packaged | REQ-137 | The four modes of the proof; the artifacts of the real backup, of the real restore and of the synced backup in the packaged application; the identities at each step |

## Success Criteria

All 18 checks pass before this spec is Verified. In the packaged application,
on the demo, the log of the real backup arrives through the tunnel and the tab
says by which way; no signed URL is found in any output of the suites.

Manual review: on the demo, ask for the log of the real backup, then of the
backup that failed its validation, then stop the server of Velero and ask
again. Expected: the log, then "no such file" with the reason of the phase, then
after thirty seconds "no URL", each with words that tell them apart. Record role,
date and verdict.

## Assumptions And Decisions

- **The interval of 250 milliseconds is kept**, as the proof of T0.6 chose it,
  and not a backoff: a working installation signs within seconds, and thirty
  seconds is the bound of the wait.
- **The addressing of the bucket is the one of the SDK of the plugin**, which
  the plugin does not change: a label of the host unless the path style is
  forced. The source of the SDK is not in the scope of this review; the rule of
  REQ-126 accepts both forms, and the unit tests give both. The demo forces the
  path style and shows one of them.
- **HTTP through the tunnel needs no allowance.** The bytes go from this machine
  to the API server inside the TLS of that connection, and from the pod to the
  storage inside the network of the cluster, which is where the installation
  itself talks to its storage. Direct HTTP from this machine is another thing,
  and needs the allowance.
- **The allowances are kept between sessions**, unlike the gate: they say
  nothing of writing, and an operator who allowed a private address once would
  be asked at every session otherwise. They are taken back from the same place.
- **Only the plugin of AWS is reviewed.** For the provider of AWS the origin of a
  location without an endpoint of its own is known; for every other provider,
  and for the partitions of AWS this rule does not know, it is an allowance,
  with the origin shown, until a spec reviews that plugin.
- **No verification turned off in v1.0.0.** The directives allow an explicit,
  visible, per-cluster choice; this spec does not offer it, and says where to
  add the certificate instead.
- **A name of the form `name.namespace.svc` is a Service by its form** and is
  never resolved on this machine: a machine whose resolver answers for it would
  otherwise block the way to the pod for nothing. Only a bare name can be both.
- **The reads the tunnel needs are outside `velero.io`**, the Service, its
  endpoint slices and the Pod of the storage, and the port-forward: an identity
  that reads Velero alone gets the state that says which of them was refused.
  The endpoint slices are read, not the endpoints, which the API deprecates.
- **The text is given in pages**, so that no message between the processes
  carries 64 MiB at once, and the main process holds one copy until the view
  lets it go.
- **The signed URL is bound to the artifact path** so that a request for a log
  cannot be turned into the fetch of another key by whatever wrote the URL.

## Evidence And Deviations

Approved on 2026-09-30, as drafted. The spec is implemented in three slices, each
with its evidence here, and is Implemented with the last of them. The proof of T0.6
is the evidence of what this spec reuses, in
[TESTING.md](../development/TESTING.md#t06-main-transport-proof).

### The Request Through The Gate, T2.1

Implemented by 2026-10-04, after an independent review of the slice, whose findings
are in the code and in its tests. The [way](../../src/main/diagnostic-service.ts) of
a request is one function, given the adapter the [gate](../../src/main/write-gate.ts)
holds for the cluster; the [procedures](../../src/main/ipc.ts) run it for the
artifact that was confirmed, join a request in flight and hold the text in the
[holder](../../src/main/artifact-holder.ts) for the frame that asked for it; the
[contract](../../src/common/ipc.ts) names the artifacts, the steps, the answer and
the pages; the [words](../../src/common/diagnostic-text.ts) are one function, which
the band of SPEC-0012 takes its words of the API server from. No view asks for an
artifact yet, and the main process has no route to the store: until the slice of the
route gives it one, the run of a DownloadRequest is refused before its token is
taken, and the extension creates none.

| Check | Evidence of this slice | Left |
| --- | --- | --- |
| DIAG-01 | Unit: the eight artifacts read, each of the kind of its target; the contents of a backup, the five other targets of the API, an artifact of the other kind and a text that is none refused by the readers of the confirmation and of the run, before the gate is asked, which a spy on the gate proves | Nothing |
| DIAG-02 | Unit: the steps in their order on a fake adapter, the target read once more before the creation and before the delivery; a restore that names no backup and a backup whose location is not there ending before the creation; a request sent again while it runs joined, one creation for the two. Through both processes: the API server of a test sent nothing by the confirmation, then the reads of the way and one creation, in their order; the extension as it is activated creating nothing | Packaged: the reads the API server counts, with the tabs of SPEC-0011 (T2.3); not run yet |
| DIAG-03 | Unit: the name, the labels and the target of the object, as the API server of a test receives it through both processes; a request read back with another UID, another label, another target or another name, and one without a UID, refused, and nothing of it used. Proof: the name and the identity of every request the cluster created | Nothing |
| DIAG-04 | Unit, on the clock of the test and on the bounds of the way itself: a read every 250 milliseconds, the wait ended at thirty seconds, the whole operation at 120, each told from the other. On bounds a test may make shorter and never longer: a request without a phase and without a URL until the bound; an expiration that passed and one that is not a time; a phase Failed | Nothing |
| DIAG-05 | Unit: every code at every step an answer of the contract, with its step, whether asking again is safe, and words without a URL; no two codes with the same words at any step; what the way found told from what a read of the cluster ended with, at the same code and step; nothing claimed of what was left at a step that is not known; every procedure answering and none raising, with a sentinel of the URL in what was raised | The codes only the transport and the route raise, and the rule of a destination that is denied, with their slices |
| DIAG-14 | Unit, in part: two operations at once, the third waiting and cancelled while it waits, through the procedures as well; the pages of a text of the largest size, none ending inside a character; the text let go by its frame, after ten minutes, when the gate lets go of its cluster for a reason of its own, and for room; a route that does not close within its bound said, and its place given back; a route and a download that do not stop left behind, and a route given late closed | The bounds of the transport (T2.2) |
| DIAG-15 | Unit, in part: a sentinel of the URL in no answer, status, failure or broadcast, through both processes; what the views take of an answer is what the contract names. Proof: no signed URL in its output | The transport (T2.2), the packaged suites (T2.3) |
| DIAG-16 | Unit: what the adapter can do pinned by name, a way to read and a way to create; the API server of a test asked for reads and one creation in each way a download ends, a file the store does not have and a cancellation among them, and both requests left as they were created; an answer of the creation lost, the request found by its name and never created a second time; not found, submission-unknown with its name. Proof: a second creation of the same name refused by the cluster, and the first kept | Nothing |
| DIAG-17 | Unit, in part, each seen failing on the code of T0.6: a creation refused before the connection, for a closed port and for a certificate that is not trusted, and one still without its connection at the bound, said not sent; an API server at an IPv6 address; the label of the name of a backup of 63, 64 and 70 characters; one connection for a creation and the reads after it, closed after two seconds without a request and when the adapter is let go, and never shared between two client certificates; a token no header takes and a certificate with a key that is not its own turned into a code, with nothing of them in it; a field of the input that is not a text; a route that does not close. The identity of the context and the key of a sender are the ones of SPEC-0009, with their evidence there | The trust of the host, the addresses, the errors of the listener, the codes of TLS, the form of the URL and the two certificates (T2.2); the endpoint slices (T2.4) |
| DIAG-18 | Proof, in part: the four modes, through the procedures of the main process, as a frame calls them | The packaged application and the identities (T2.3, T2.4) |

What was decided while implementing, inside the requirements:

- **The gate is the only authority.** The service of T0.6 confirmed a request, bound
  it to its sender and cancelled it by itself, and the design above says that the
  service stays what it is. With the gate of SPEC-0009 that would be a second
  authority beside the first: the way is a function now, the first step of REQ-121
  is the confirmation of the gate, and the cancellation is the one of the gate.
- **Nothing is created while there is no route.** A request the main process could
  not download for would be a write for nothing: the run is refused before its token
  is taken, with words that say the artifacts come with a later version.
- **An artifact is of the kind of its target.** The log of a restore is not asked of
  a backup: the readers refuse it, as they refuse a target that is none of the eight.
- **A request sent again joins only its own.** The same identifier, from the same
  frame, for the same artifact of the same target and with the same token, is given
  the answer of the request in flight; from any other it is refused, and learns
  nothing of it.
- **The step of the creation is the creation alone.** The target is read once more
  before it, as a step of its own, so that what ends at the creation says what is
  known of the request: a cancellation, the end of the whole operation and a
  connection that changed say that it may be in the cluster; a refusal of the
  cluster, and a creation that was not sent, say that it is not.
- **What the way found is told from what a read ended with.** REQ-124 gives one code
  to a URL that was not signed and to a read the cluster did not answer in time,
  one to a request that says it failed and to a read that failed, one to a request
  that is another and to a connection that changed. The failure carries which of
  them it is, and the words of the second kind say nothing of Velero. An expiration
  that passed has words of its own: on a request this machine created a moment
  before, it says that two clocks do not agree.
- **The two bounds are told apart.** The thirty seconds of the wait say that Velero
  signed no URL; the two minutes of the whole operation say only that it was
  stopped, and what it left.
- **What the way waits for ends with the operation.** A route or a download that
  does not stop when it is told to is left behind, so that it holds neither the
  operation nor one of the two places of the process; a route given late is closed.
  An operation that was stopped while what it opened was closed delivers nothing.
- **What the process holds is bounded.** REQ-133 gives the ten minutes and the
  release by the view. The holder adds a bound on what is held at once, sixteen
  texts and 128 MiB, and lets the oldest go for room: sixteen views that never let
  their text go would otherwise hold 1 GiB. A text goes as well when the gate lets
  go of its cluster for a reason of its own, with writes on or off; writes turned
  off by the operator leave it.
- **A page ends where a character ends**, so that no page begins with half of one:
  a page is 4 MiB at most, and less by up to three bytes.
- **The adapter is let go with the gate of its cluster**, and closes the connections
  it kept. A connection is kept for two seconds without a request, and no longer: a
  creation written on one that was closed on the way would be an answer that was
  lost.
- **A creation that was not sent says so in the band of the server too.** The words
  of SPEC-0012 for a request the server did not answer said that it stays: with the
  adapter telling a creation that was not sent from one that may have been, a
  creation the cluster did not take in time says that nothing was created.

Open, for the slice of the transport: REQ-131 says that a Secret the identity may
not read ends as tls-invalid, REQ-124 and REQ-137 that it ends as forbidden at the
step of the Secret. The code of T0.6 gives forbidden, and the words of this slice say
that the cluster refused the read of the Secret, which verb the identity needs, and
that no connection is made without verification. The slice of the transport keeps
what the code gives, and says below why the two requirements are still to be made
one.

### The Transport, T2.2

Implemented by 2026-10-04, after an independent review of the slice, whose findings
are in the code and in its tests. The [transport](../../src/main/diagnostic-transport.ts)
trusts what the host trusts, reads the addresses by what they are, tells a failure of
TLS from a store that was not reached by where the connection was, and sends the host
its URL was signed for; the [rules on the addresses](../../src/common/artifact-address.ts)
are pure functions; the [tunnel](../../src/main/diagnostic-tunnel.ts) hears the errors
of its listener; the [adapter](../../src/main/diagnostic-kubernetes.ts) takes the
certificate a location refers to before the one it carries. The transport proof asks
the server and the store for what is not there as well.

| Check | Evidence of this slice | Left |
| --- | --- | --- |
| DIAG-06 | Unit: a 404 of the store, a connection that is refused, a certificate that is refused and a URL that is not signed are four codes, and a connection lost while the file arrives is a store that was not reached, not a file that cannot be read. Proof, against the store of the test environment: the log of a backup and of a restore that failed their validation for naming both kinds of selector, for which the server signs a URL, ends as a file the store does not have at the step of the download, and its request is in the cluster; the log of a restore asked from a schedule that has no backup ends before any creation, at the step of the backup, and no request of its name is in the cluster | Packaged: the same operations in the tabs (T2.3) |
| DIAG-09 | Unit, in part: every range REQ-128 names, in IPv4 and in IPv6, in every written form, compressed, expanded, in capitals, carried by an IPv6 address; the metadata addresses that are in no refused range, each refused with an allowance in every written form, and the addresses beside them left what their range is; a private address with and without one; the loopback only through a tunnel or to a server of a test, and a route whose mode is no word of the three refused; the socket given the address in its canonical form and the name of the URL kept for TLS and for the host | The name resolved on this machine, and two addresses of which the first is refused, with the route (T2.4) |
| DIAG-11 | Unit, in part: plain HTTP refused for a route that does not allow it, and no downgrade of a URL of HTTPS. Proof: HTTP through the tunnel | The allowance and what the state says of it (T2.4) |
| DIAG-12 | Unit: an authority that is only among the ones the runtime lists, and one that is only among the ones of the system, accepted with and without a certificate of the location; the certificate of the location accepted beside them and alone; an authority that is in none refused; a runtime that cannot list them. The certificate a location refers to, the inline one, both with the reference taken; a key that is not in the Secret and a value that is not a certificate ending as tls-invalid, with no connection made; a location that asks for no verification verified all the same, and the state saying so of a certificate that was refused and not of a handshake that failed for another reason. Proof: the inline and the referenced certificate, and a certificate that is missing refused | Packaged, with the tabs (T2.3). A Secret the identity may not read: see below |
| DIAG-14 | Unit: each bound reached, of the bytes as they are stored and as they are read, of the connection, of the silence and of the whole download; for each of seventeen ways a download ends, the request, the socket and the decoder closed and the side of the store closed; the listener of the tunnel closed with the operation and on its own errors. With T2.1: the two operations at once, the pages and their release, a route that does not close | Nothing |
| DIAG-15 | Unit: a sentinel in the query of the URL in no error, no value a failure carries, no line of the console and neither stream of the process, for every way a download ends and for a URL refused before any connection. Proof: no signed URL in its output or in its reports | The reports of the packaged suites (T2.3) |
| DIAG-17 | Unit, each seen failing on the code of T0.6: the trust of the host; the rules on the addresses in canonical form, with the two metadata addresses; every failure of TLS, by the phase of the connection, with a certificate that was refused told from a handshake that failed, and, through a tunnel, a store that answers the handshake with something else told from a connection that was lost; a URL with the port of its scheme or a host in capitals, with the host sent as it was signed; a listener with a handler of its errors; a location with both certificates. With T2.1 every item of REQ-136 but the endpoint slices | The endpoint slices in place of the endpoints (T2.4) |
| DIAG-18 | Proof, in part: the four modes, with what the store and the server answer for what is not there | The packaged application and the identities (T2.3, T2.4) |

What was decided while implementing, inside the requirements:

- **A failure of TLS is told by where the connection was.** Before the connection is
  made the store was not reached; between the connection and the end of the handshake
  TLS failed, whatever the runtime names the failure; after it the connection was
  lost. Through a tunnel the connection that is made is the one to the listener of
  this process, which says nothing of the store: there a connection the system says
  was lost, by one of the four names it has for that, is a store the tunnel did not
  reach, and what else fails the handshake is of TLS, as a store that answers it
  with something else.
- **A certificate that was refused is told from a handshake that failed.** The
  socket says which it was. The words send the operator to the certificate of the
  location only for the first, and say of the second that the store may not speak
  TLS at the port of its URL; what a location asks with `insecureSkipTLSVerify` is
  said only where a certificate was refused.
- **A route says how its address is reached with one of three words**, direct,
  through a tunnel or to a server of a test, and a route with any other is refused.
  A tunnel and a server of a test are on the loopback of this machine, and a direct
  route never is.
- **An address is read into its numbers.** What is not an address in one written
  form is refused: a number with a zero before it, which some resolvers read as
  octal; a zone; a prefix. An IPv4 address an IPv6 one carries is what the IPv4
  address is, under the two prefixes that say so by themselves; the loopback a
  translator carries is refused, as it would be the one of the translator; the rest
  of the range the standard took back, an IPv4 address after ninety-six zeros, is
  refused. Under the prefix the standard keeps for the translators a network runs
  for itself, `64:ff9b:1::/48`, the last two groups are read as the IPv4 address
  that is reached, which is where the usual length of such a prefix carries it. A
  translator of any other prefix a network chose cannot be known from an address.
- **More addresses of metadata services are refused than REQ-128 lists.** The
  requirement names the ranges and the two addresses known when it was written;
  `100.100.100.200`, `192.0.0.192`, `fd20:ce::254` and `fd00:a9fe:a9fe::1` are
  where other clouds serve theirs, each one address inside a range a store may be
  in. Each is refused with or without an allowance, and the addresses beside it are
  what their range is.
- **A runtime that cannot list what the host trusts** is left to trust what it
  trusts by itself where the location gives no certificate, which is more than its
  own roots, and is given its roots with the certificate where the location gives
  one.
- **The host that is sent is the one that was signed**: as the URL writes it,
  capitals kept, and without the port when it is the one of the scheme. The origin is
  compared after the capitals and that port are taken out, and nothing else a parser
  reads as the same origin is taken for it. What the signer of the reviewed plugin
  does with such a host was not seen against a store: the URLs of the test
  environment have neither, and a host the store did not sign is answered with a
  refusal, never with another file.
- **A location that gives both certificates takes the one it refers to**, as the
  release does, and what the Secret does not give is not made up for with the inline
  one.
- **`insecureSkipTLSVerify` is read to say it, and for nothing else.** The route a
  download is given never carries it.
- **A file cut while it arrives is told by its gzip alone when its answer is
  delimited by the close of the connection.** Such an answer has no length to be
  short of: it ends as a file that cannot be read, where one with a length ends as
  a store that was lost.
- **The operations the server refuses are of the proof, not of the demo.** They are
  made after the real backup and the real restore, asked for once, through the
  tunnel over HTTP, and removed with the run: the backup by a deletion request the
  controller carries out, the restore of the real backup with that backup, the
  restore without a backup by its identity. The tabs of SPEC-0011 bring them into
  the demo with their suites.

Open, for the review of the milestone: a Secret the identity may not read. REQ-131
says tls-invalid; REQ-124 and REQ-137 say forbidden at the step of the Secret, which
is what the code gives and what the words say, with the verb the identity needs. No
connection is made without verification either way. The two requirements are to be
made one, and the code follows what is decided.
