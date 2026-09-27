// Stands in for undici in the main bundle and in the tests. The Kubernetes client imports
// undici for its fetch based API clients, which this extension never calls: the adapter owns
// its HTTPS requests. The real module installs a dispatcher for the whole process when it
// loads, which inside Freelens would be the process of the host.

function unavailable(): never {
  throw new Error("undici is not part of this extension");
}

export class Agent {
  constructor() {
    unavailable();
  }
}

export class ProxyAgent {
  constructor() {
    unavailable();
  }
}

export function fetch(): never {
  return unavailable();
}
