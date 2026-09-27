# Instructions for GitHub Copilot and other coding agents

The canonical agent guide for this repository is [AGENTS.md](../AGENTS.md)
in the repository root. Read it first and follow it strictly, in particular:

- the licensing and provenance constraints: this extension is MIT and written
  from scratch, with official upstream artifacts only and no patched or rebuilt
  third-party software;
- the safety rules: every Kubernetes write of development and tests goes to a
  disposable kind cluster, no cloud account is accessed without an explicit
  authorization, the data of real environments never leave the machine that read
  them, signed URLs stay in the main process;
- the spec-driven process and the testing requirements documented under
  `docs/development/`: no feature without an approved spec, every feature
  ships with its tests;
- the CRD KubeObject pattern, the code style and the text rules in AGENTS.md.
