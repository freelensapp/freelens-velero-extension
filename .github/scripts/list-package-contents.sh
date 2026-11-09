#!/bin/bash
# What the package contains (REQ-316 of SPEC-0018): the list the job `package` of the release workflow makes of
# the tarball it packed, which a unit case runs as well on synthetic packages. It prints the files of the tarball,
# and fails on a file outside the files of package.json, dist/, and what the packer always adds, the manifest, the
# README and the license; on a file named as the Security section of AGENTS.md names a credential; on an absolute
# path of the machine that built it, the home of the runner or the workspace, in any file; and on the form of a
# credential the private-data rules of AGENTS.md name, in any file: a private key, a kubeconfig, a token of npm or
# of GitHub. The license notice of react-window, the library the renderer bundle carries, travels beside that
# bundle, and the list finds it. The words of a failure name the files of the package, never what matched in
# them. Its argument: the tarball. It unpacks it in a folder of its own under RUNNER_TEMP, and reads HOME and
# GITHUB_WORKSPACE.
set -euo pipefail

tarball=$1
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/contents.XXXXXX")
trap 'rm -rf "${work}"' EXIT
list="${work}/list"
failed=0
fail() {
	echo "::error::$1"
	failed=1
}

tar -tzf "${tarball}" | grep -v '/$' | LC_ALL=C sort >"${list}"
cat "${list}"
outside=$(grep -Ev '^package/(package\.json|README\.md|LICENSE|dist/.+)$' "${list}" || true)
[ -z "${outside}" ] || fail "Files outside dist/, the manifest, the README and the license: ${outside//$'\n'/ }"
named=$(grep -E '/(\.env(\..*)?|\.envrc|\.npmrc|[^/]*\.(jks|keystore|p12|pfx|pem|key|kubeconfig)|kubeconfig|credentials\.json|velero-credentials)$' "${list}" || true)
[ -z "${named}" ] || fail "Files named as a credential: ${named//$'\n'/ }"
notice=package/dist/renderer.js.LICENSE.txt
grep -qxF "${notice}" "${list}" || fail "The notice of the license of react-window is not in the package: ${notice}"

mkdir "${work}/unpacked"
tar -xzf "${tarball}" -C "${work}/unpacked"
cd "${work}/unpacked"
if [ -f "${notice}" ] && ! { grep -qE '^react-window [0-9]' "${notice}" && grep -qF 'Permission is hereby granted, free of charge' "${notice}"; }; then
	fail "${notice} holds no MIT notice of react-window"
fi
paths=$(grep -rlaF -e "${HOME}" -e "${GITHUB_WORKSPACE:-${HOME}}" package || true)
[ -z "${paths}" ] || fail "An absolute path of the runner in: ${paths//$'\n'/ }"
credentials=$(grep -rlaE \
	-e '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY' \
	-e 'client-key-data|client-certificate-data|certificate-authority-data|current-context|^kind: Config|"kind": *"Config"' \
	-e '_authToken|npm_[A-Za-z0-9]{36}' \
	-e '(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}' \
	package || true)
[ -z "${credentials}" ] || fail "The form of a credential in: ${credentials//$'\n'/ }"
exit "${failed}"
