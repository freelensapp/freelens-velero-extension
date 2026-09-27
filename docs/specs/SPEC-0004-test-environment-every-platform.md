# SPEC-0004: Test Environment On Every Platform

- **Status:** Implemented
- **Date:** 2026-09-27
- **Milestone / tasks:** Foundation
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`
- **Reviewed main:** not relevant: the environment installs the reviewed release only
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [foundation](SPEC-0001-local-foundation.md)
- **Approval:** Approved by the lead maintainer on 2026-09-27, with the published loopback accepted on the machines of the developers

Governed by [AGENTS.md](../../AGENTS.md).

## Goal

Let every contributor and the hosted checks bring up the test environment of
[SPEC-0001](SPEC-0001-local-foundation.md), with its safety guards, and take it down
again, with one command each.

## Scope Baseline

The [scripts](../../e2e/scripts/) of the foundation create a dedicated kind cluster
with Velero, its AWS plugin and SeaweedFS, run real backups and restores of synthetic
data and fetch their artifacts through the compiled main. They ran on one Linux
x86_64 machine. Read from the code, not from a run, this is what ties them to it:

| Tie | Where |
| --- | --- |
| The Docker daemon must report `x86_64`, and the images are pulled and asserted as `linux/amd64` | `local-demo.mts` `preflight`, `local-images.mts` `pull` |
| A private kind binary is expected and no script installs it | `local-demo.mts` `KIND` |
| kubectl of the host must be exactly v1.33.4 | `local-demo.mts` `preflight` |
| The routes of the host are read with `ip`, of iproute2 | `local-demo.mts` `preflight` |
| The host reaches the API server at the address of the node, on an internal Docker network that publishes no port | `local-demo.mts` `setupCluster` |
| The check of the egress rules listens on the gateway of the Docker bridge, an address of the host on Linux only | `local-demo.mts` `verify` |
| The Docker socket is `/var/run/docker.sock` | `local-kind.mts` `DOCKER_HOST` |
| Docker must show 8 GiB of memory or more | `local-demo.mts` `preflight` |
| The image of the direct transport proof is never pulled by `pull` | `local-images.mts` `pull` |

Included: the platforms below, the installation of the pinned binaries, the two
network shapes, the commands, the hosted workflow, the updates of the pins.
Excluded: the Playwright suite against the views and the pre-review pass, which
come with the first views of M1; Windows.

| Platform | Host | Network shape |
| --- | --- | --- |
| Linux x64 | developer machine, hosted runner | internal bridge |
| Linux ARM64 | developer machine, hosted runner | internal bridge |
| macOS x64 and ARM64 | developer machine with Docker Desktop | published loopback |

## User Scenarios

1. **P1, a contributor on macOS:** Given Docker Desktop and Node.js of `.nvmrc`, when
   `pnpm e2e:cluster:up` runs, then the dedicated cluster is ready with Velero and
   the storage, and `pnpm e2e:cluster:down` removes the cluster and the network the
   journal owns and nothing else.
2. **P1, the hosted checks:** Given a runner of the workflow, when a pull request
   changes the extension, then the workflow brings the environment up, runs the
   fixtures and the transport proof, takes the environment down and uploads nothing
   of the private state.
3. **P1, a wrong target:** Given a kubeconfig, a node or a network that the journal
   does not own, when any command runs, then it stops before the first request to
   Kubernetes, on every platform.
4. **P2, an interrupted run:** Given a run killed halfway, when the next command
   runs, then it says which lock or phase is left and how to resume, and it does not
   delete the journal.

## Requirements

| ID | Contract | Acceptance check |
| --- | --- | --- |
| REQ-038 | The platform comes from the Docker daemon. The images are pulled for it and asserted for it; every pin is the digest of a multi-platform index that has both `linux/amd64` and `linux/arm64`, or the command stops and names the pin | ENV-01 |
| REQ-039 | The scripts install kind and kubectl for the system and the architecture of the host from their official releases, against checksums pinned in the repository, under the private state; no binary of the host is used or changed | ENV-02 |
| REQ-040 | On Linux the network is the internal bridge of the foundation. Where the host cannot reach the address of the node, the bridge is dedicated and not internal, the API server is published on `127.0.0.1` only, and the egress rules of the node are in place before the first workload is created | ENV-03 |
| REQ-041 | The identity check accepts the two shapes of REQ-040 and nothing else: a published port on another address, a second network or a second node stop the command | ENV-04 |
| REQ-042 | The egress rules are proven on every platform with a helper container on the owned network: it answers a request from the network, then the node and a pod are refused when they call an address outside the cluster, with the counters of the rules increasing | ENV-05 |
| REQ-043 | The preflight compares the subnets of the environment with the Docker networks everywhere, and with the routes of the host where `ip` exists; where it does not, the command says that the routes were not checked | ENV-06 |
| REQ-044 | `e2e:cluster:up` is idempotent and resumes an environment it owns; `e2e:cluster:down` deletes the cluster and the network the journal owns after the identity check, and refuses everything else | ENV-07 |
| REQ-045 | The default kubeconfig of the user is never written. Its hash is compared before and after every run, not against a baseline stored once | ENV-08 |
| REQ-046 | The log of the operations withholds the body of every Secret and every token; the hosted workflow uploads no file of the private state | ENV-09 |
| REQ-047 | The child processes get an environment built from an allowlist | ENV-10 |
| REQ-048 | The hosted workflow runs the fixtures and the transport proof on the runner of the other workflows and fails on any check that does not pass | ENV-11 |
| REQ-049 | Renovate follows the pins of the images and of the binaries; a pull request that updates one carries the note of the upstream drift watch | ENV-12 |

## Design

The scripts stay TypeScript, run by Node.js of `.nvmrc`, with the ownership journal,
the refusal of collisions, the deletes bound to a UID and the private home they have.
`package.json` gets `e2e:cluster:up`, `e2e:cluster:down`, `demo:up` and `demo:down`,
the names of the other extensions. `up` runs the actions of today in their order:
images, cluster, storage, bucket, Velero, verify.

**Standard or ad hoc view, and why.** No view: this spec is about the environment.

**Safety.** The environment writes to the cluster it created and to nothing else.
The two network shapes differ in what holds the node back:

| | Internal bridge | Published loopback |
| --- | --- | --- |
| The node cannot reach outside | by construction, Docker gives the network no route, and by the egress rules of the node | by the egress rules of the node only |
| Between the creation of the node and the egress rules | nothing can leave | the node could reach outside |
| The API server | at the address of the node, reachable from the host only | on `127.0.0.1` of the host, a port Docker chooses |
| A name outside the cluster | not resolved: the resolver of Docker is refused to the node and to its pods | the same |

On the published loopback the images are preloaded and the workloads never pull, as
today. The window of the second row ends when the egress rules are installed, the
first step after the node exists, before the storage and Velero. It is made short,
not removed. ENV-03 proves the order, ENV-05 the rules. The internal bridge stays the
shape of the hosted checks.

The rules live in the network namespace of the node and go with it when the node
stops. When the node starts again they are installed as soon as it runs, before its
workloads do, and once more in front of the rules the node writes for its services.
A chain that does not hold the expected rules in their order is written again.

The resolver of Docker answers for names outside the cluster, and the node reaches
it through the gateway of the bridge as traffic that is delivered, not forwarded. A
third chain refuses it on arrival, for the node and for its pods.

The host listener of today is replaced on both shapes by the helper container of
REQ-042, from the pinned Node.js image the transport proof already uses.

The removal works by identifier: the node and the network the journal names, and
the helpers that carry the label of the owner. It records each step, so a removal
that stopped halfway is finished by the next one. What Docker no longer has counts
as removed; what Docker has under the dedicated names and the journal does not own
stops the command.

## Tests

Planned homes: the environment tests for the pure checks, with synthetic inspections
of nodes and networks; the runs of the commands on macOS and on the hosted runners
for the rest.

| Check | Layer | Requirements | Scenario and expected evidence |
| --- | --- | --- | --- |
| ENV-01 | Unit, run | REQ-038 | A daemon on `aarch64` and one on `x86_64` select their platform; a pin without one of the two stops the command and is named |
| ENV-02 | Unit, run | REQ-039 | A download with another checksum is refused and removed; the installed binaries report the pinned versions; the binaries of the host are not called |
| ENV-03 | Run | REQ-040 | On each shape the journal records the egress rules before the first workload; on macOS the API answers on `127.0.0.1` only |
| ENV-04 | Unit | REQ-041 | Synthetic inspections: a port published on `0.0.0.0`, a second network, a second node, a changed kubeconfig are each refused |
| ENV-05 | Run | REQ-042 | The helper answers inside the network; node and pod are refused outside it; the counters increase; the helper is removed |
| ENV-06 | Unit, run | REQ-043 | An overlapping Docker network stops the command; without `ip` the output says the routes were not checked |
| ENV-07 | Run | REQ-044 | `up` twice gives the same environment; `down` leaves no node and no network of the journal, and another cluster of the machine untouched |
| ENV-08 | Unit, run | REQ-045 | The default kubeconfig has the same hash before and after; a change made between two runs does not stop the second |
| ENV-09 | Unit, run | REQ-046 | The log holds no generated credential and no token after a full run; the workflow has no upload of the state directory |
| ENV-10 | Unit | REQ-047 | A variable outside the allowlist does not reach a child process |
| ENV-11 | Hosted run | REQ-048 | The workflow is green on a pull request and red when a check of the fixtures is made to fail |
| ENV-12 | Configuration check | REQ-049 | The validator of Renovate accepts the configuration and its dry run lists the pins |

## Success Criteria

All 12 checks pass. The environment comes up and goes down on Linux x64, Linux ARM64
and macOS. The real backup and restore, the fixtures and the transport proof of
SPEC-0001 pass unchanged on each. No command touches a cluster, a network or a
kubeconfig it does not own.

Manual review: on macOS, with another kind cluster running, bring the environment up
and down. Expected: the other cluster and the default kubeconfig are as they were.
Record role and date.

## Assumptions And Decisions

- The hosted checks keep the internal bridge, the stronger shape.
- The capacity check asks for four processors and the memory the node is limited to,
  read from the daemon, not a fixed 8 GiB that a virtual machine of 8 GB misses.
- Decided by the lead maintainer on 2026-09-27, REQ-040: the published loopback is
  acceptable on the machines of the developers, with the window of its second row.
  The alternative was that the environment runs on Linux only and on macOS through
  the hosted checks.

## Evidence And Deviations

Implemented on 2026-09-27 and merged the same day; the hosted checks are green on
main, the E2E tests among them. The status moves to Verified when the manual review
of the Success Criteria is recorded here, with role and date. The runs below are the
evidence of the pull request of the implementation.

| Check | Evidence |
| --- | --- |
| ENV-01 | Unit: the platform follows the daemon, a pin without one of the two platforms is refused and named, from the registry and from the engine. Runs: the five pins accepted for `linux/amd64` on macOS x64 and for `linux/arm64` on the hosted runner |
| ENV-02 | Unit: a download with another checksum is refused. Runs on macOS x64 and on the hosted runner: kind v0.33.0 and kubectl v1.33.4 installed from their releases; no script names a binary of the host |
| ENV-03 | Run on macOS x64: the journal records the isolation before the images are imported and the storage is created; the API server is published on `127.0.0.1` and nowhere else. Run on the hosted runner: the internal shape, no published port |
| ENV-04 | Unit: the two shapes accepted, nine refusals each with its reason, the node ownership of the removal |
| ENV-05 | Runs on macOS x64 and on the hosted runner: the helper answers inside the network, node and pod are refused outside it and by the resolver of Docker, the counters increase, the helper is removed |
| ENV-06 | Unit: an overlapping Docker network is found with and without the routes. Run on macOS x64: the output says the routes were not checked. Run on the hosted runner: the routes are checked |
| ENV-07 | Run on macOS x64, beside another kind cluster: `up` twice gives the same node; `down` leaves no node, network or state; the containers, networks, volumes and the other cluster, its node and its pods, are the same before and after |
| ENV-08 | Unit, through the entry point with a Docker that answers from files: a change between two runs does not stop the second, a change during a run stops it. Run on macOS x64: the same hash before and after the round |
| ENV-09 | Unit: a Secret is recorded without its body, a generated secret is found as it is and encoded. Runs: every command ends with the search, on a log of more than 100 MB on macOS. Unit: the workflow has no upload |
| ENV-10 | Unit: a variable outside the allowlist does not reach a child process |
| ENV-11 | Hosted runs on Linux ARM64: green on the pull request of the implementation; red on a pull request that asked the reader of the fixtures for one backup more than it lists, at that check, with the environment taken down after it |
| ENV-12 | The validator accepts the configuration; the dry run on the repository lists the seven pins, in their groups. After the merge Renovate opened the pull requests of the two groups, each with the note of the upstream drift watch, the one of the binaries with the note of the checksums |

On macOS the runs also covered what the scenarios ask of an interrupted run: a run
killed while the node was created, the lock it left, the node it left, and the
removal of both; a temporary check interrupted before and after it created its
object, and one that names the object of another owner, which is refused and left;
a node stopped and started three times, each time with its rules back before its
workloads and first in their chains. Linux on a developer machine was not run: the
Linux evidence is the one of the hosted runner, ARM64.

Deviations, each called out in the pull request:

- REQ-049: Renovate does not follow the image of the helper. Its Node.js is the one
  of `.nvmrc`, which Renovate ignores in every repository of the organization, and
  it moves with it by hand. Renovate moves the versions of kind and kubectl, not the
  checksums pinned beside them: its pull request says so.
- The images are not loaded by kind. With the containerd image store of Docker its
  import asks for every platform of an index, and only one was pulled. The scripts
  import the archive, and the node must name each image by the configuration the
  pinned index gives for the platform, read from the archive with the digest of
  every blob checked.
- The processes that run inside the network of the node use a second kubeconfig,
  with the address of the node. The kubeconfig of the environment is stored as JSON
  on both shapes.
- The third chain, the rules after a restart and the removal by identifier, in the
  Design above, came from the review of the implementation and from its runs.
- On the internal shape kind ends with an error after the node is complete: it looks
  for the published port of the API server, and there is none. The node says whether
  its creation completed: its administrator reads the add-ons that come last in it.
  A creation that did not complete stops the command, which prints the lines of the
  failed command that name an error, without traces and without anything long
  enough to be a key, a token or a certificate.
- The API server of a node that has just started answers 403 for a few seconds. The
  check of the foundation asked once and took that for a failure, on a fast
  machine. It asks until the API server says that it is alive.
- The registry is asked only for what the machine does not have. Asked at every
  run for images that were already here, it refused the machine after a few runs,
  at the rate it grants to requests without an account. The index of a pin comes
  from the engine when it holds it, and the pins that were read are remembered.
- The verification of the foundation stopped for good when its temporary check was
  interrupted before it created anything. It now removes what the earlier one left.
- On an environment just created the transport proof of the foundation could not
  apply the secure variant of the storage, whose fields belonged to the `create` of
  the same setup. The apply takes them after the identity check, with the uid as
  its precondition.
- The log of the foundation recorded the body of the Secrets it read back, encoded.
  Every recorded output now passes through a filter that withholds the body of a
  Secret and the credentials of a kubeconfig, and the search that ends every command
  looks for the generated secrets in their encoded forms too.
