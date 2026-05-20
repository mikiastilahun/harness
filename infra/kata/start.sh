#!/usr/bin/env bash
# Boot the kata sandbox: start colima, ensure /etc/containerd/config.toml has the
# kata stanzas (it gets reset to a 2-line stub on every `colima stop` cycle),
# and restart containerd via the kata-deploy pod (avoids relying on
# `colima ssh`, which can fail when the user's shell rc fights us).

set -euo pipefail

PROFILE="${COLIMA_PROFILE:-harness}"
CONTEXT="colima-${PROFILE}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/containerd-config.toml"

if ! command -v colima >/dev/null; then
  echo "colima not found. install: brew install colima" >&2
  exit 1
fi

if ! colima list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$PROFILE"; then
  echo "colima profile '$PROFILE' does not exist." >&2
  echo "run ./infra/kata/setup.sh once to provision it." >&2
  exit 1
fi

status=$(colima list 2>/dev/null | awk -v p="$PROFILE" 'NR>1 && $1==p {print $2}')
if [ "$status" = "Running" ]; then
  echo "==> colima '$PROFILE' already running"
else
  echo "==> starting colima '$PROFILE' (status was '$status')"
  colima start --profile "$PROFILE"
fi

echo "==> waiting for k8s API"
for _ in $(seq 1 60); do
  kubectl --context "$CONTEXT" get --raw=/readyz >/dev/null 2>&1 && break
  sleep 1
done

echo "==> waiting for kata-deploy DaemonSet"
kubectl --context "$CONTEXT" -n kube-system rollout status ds/kata-deploy --timeout=5m

POD=$(kubectl --context "$CONTEXT" -n kube-system get pods -l name=kata-deploy \
  -o jsonpath='{.items[0].metadata.name}')
if [ -z "$POD" ]; then
  echo "no kata-deploy pod found" >&2
  exit 1
fi

kata_lines=$(kubectl --context "$CONTEXT" -n kube-system exec "$POD" -- \
  sh -c 'grep -c kata /host/etc/containerd/config.toml 2>/dev/null || echo 0')

if [ "$kata_lines" -gt 0 ]; then
  echo "==> containerd config already has kata runtimes ($kata_lines matches)"
else
  echo "==> writing kata runtimes into /etc/containerd/config.toml"
  cat "$CONFIG" | kubectl --context "$CONTEXT" -n kube-system exec -i "$POD" -- \
    sh -c 'cat > /host/etc/containerd/config.toml'
  echo "==> restarting containerd"
  kubectl --context "$CONTEXT" -n kube-system exec "$POD" -- \
    nsenter -t 1 -m -u -i -n -p -- systemctl restart containerd
  sleep 3
fi

echo "==> ready: kubeconfig context = $CONTEXT"
