#!/usr/bin/env bash
# Boot the agent-sandbox kind cluster. kind backs each node with a docker
# container; `docker stop` puts it to sleep, `docker start` brings it back —
# much faster than recreating the cluster.

set -euo pipefail

CLUSTER="${KIND_CLUSTER:-harness-agent-sandbox}"
CONTEXT="kind-${CLUSTER}"
NODE="${CLUSTER}-control-plane"

for bin in kind kubectl docker; do
  if ! command -v "$bin" >/dev/null; then
    echo "$bin not found on PATH. install: brew install $bin" >&2
    exit 1
  fi
done

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "kind cluster '$CLUSTER' does not exist." >&2
  echo "run ./infra/agent-sandbox/setup.sh once to provision it." >&2
  exit 1
fi

state=$(docker inspect --format '{{.State.Status}}' "$NODE" 2>/dev/null || echo missing)
case "$state" in
  running) echo "==> kind '$CLUSTER' already running" ;;
  exited|created|paused)
    echo "==> starting kind node container '$NODE' (was $state)"
    docker start "$NODE" >/dev/null
    ;;
  missing)
    echo "node container '$NODE' is missing but cluster is registered." >&2
    echo "recreate with: kind delete cluster --name $CLUSTER && ./infra/agent-sandbox/setup.sh" >&2
    exit 1
    ;;
  *) echo "unexpected docker state '$state' for $NODE" >&2; exit 1 ;;
esac

echo "==> waiting for k8s API"
for _ in $(seq 1 60); do
  kubectl --context "$CONTEXT" get --raw=/readyz >/dev/null 2>&1 && break
  sleep 1
done

echo "==> waiting for agent-sandbox controller"
kubectl --context "$CONTEXT" -n agent-sandbox-system rollout status \
  deploy --timeout=2m

echo "==> ready: kubeconfig context = $CONTEXT"
