#!/bin/sh
# The credential plugin of the identity of the views whose kubeconfig takes its token from an `exec` plugin,
# which the runner of the suites makes for as long as they run (`runViews` in local-demo.mts). Whatever
# authenticates with that kubeconfig runs it: it prints an ExecCredential of client.authentication.k8s.io/v1
# with the token of the account, which the runner wrote in the private state of the environment and nowhere
# else, and it adds to the file of its runs, in that state as well, one line: the name of the executable of
# the process that ran it, and nothing of a token or of a kubeconfig. It writes nothing else, and nothing on
# its error output, which the one that ran it may log. Its arguments: the file of the token, then the file of
# the runs.
set -eu
PATH=/usr/bin:/bin
export PATH

token_file=$1
runs_file=$2

# The parent, by the file of its executable: on Linux the link of the process in /proc, since the table of
# the processes cuts the name at fifteen characters there; elsewhere the table, which gives the whole path.
if [ -e "/proc/$PPID/exe" ]; then
	parent=$(readlink "/proc/$PPID/exe" 2>/dev/null || true)
else
	parent=$(ps -o comm= -p "$PPID" 2>/dev/null || true)
fi
parent=${parent##*/}
printf '%s\n' "${parent:-unknown}" >>"$runs_file"

# A token is a JSON Web Token: what is not one is not printed.
token=$(cat "$token_file")
case $token in
'' | *[!A-Za-z0-9._-]*) exit 1 ;;
*) ;;
esac
printf '{"apiVersion":"client.authentication.k8s.io/v1","kind":"ExecCredential","status":{"token":"%s"}}\n' "$token"
