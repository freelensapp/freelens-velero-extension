# SPEC-0004: Test Environment On Every Platform

- **Status:** Draft
- **Date:** 2026-09-27
- **Milestone / tasks:** Foundation
- **Reviewed Velero:** v1.18.2, `c253c7fe37d78c9b7e55c68544f7c5b2608712d8`
- **Reviewed main:** not relevant: the environment installs the reviewed release only
- **Freelens validation target:** v1.10.3, `3da74415bff57a77c6e08cb5f538191ce87bac17`
- **Dependencies:** [foundation](SPEC-0001-local-foundation.md)
- **Approval:** Pending

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

On the published loopback the images are preloaded and the workloads never pull, as
today. The window of the second row ends when the egress rules are installed, the
first step after the node exists, before the storage and Velero. It is made short,
not removed. ENV-03 proves the order, ENV-05 the rules. The internal bridge stays the
shape of the hosted checks.

The host listener of today is replaced on both shapes by the helper container of
REQ-042, from the pinned Node.js image the transport proof already uses.

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
- NEEDS CLARIFICATION, REQ-040: is the published loopback acceptable on the machines
  of the developers, given the window of its second row? The alternative is that the
  environment runs on Linux only and on macOS through the hosted checks.

## Evidence And Deviations

Draft only. No implementation, tests or runtime evidence. The ties of the Scope
Baseline come from reading the scripts; none was reproduced by a run.
