// The store of the direct route FND-10 resolves in the main process of the host (REQ-290 of SPEC-0018): an address
// literal of 198.18.0.0/15, a range the extension counts as private. Nothing of the tests listens there, and the
// runners do not route it. The environment of the tests takes subnets from the same range, `SUBNETS` of
// `e2e/scripts/local-kind.mts`, and a unit case of the environment keeps the address outside every one of them.
export const PRIVATE_STORE_ADDRESS = "198.18.250.10";
