#!/usr/bin/env bash
# One-shot provisioner for the agent-sandbox controller on a local kind cluster.
# https://agent-sandbox.sigs.k8s.io/docs/getting_started/install_prerequisites/
#
# Idempotent: re-running is safe. Creates the cluster if missing, installs the
# manifest + extensions at the pinned version, and runs a hello-world smoke test.

set -euo pipefail

CLUSTER="${KIND_CLUSTER:-harness-agent-sandbox}"
CONTEXT="kind-${CLUSTER}"
VERSION="${AGENT_SANDBOX_VERSION:-v0.4.6}"
HERE="$(cd "$(dirname "$0")" && pwd)"

for bin in kind kubectl docker; do
  if ! command -v "$bin" >/dev/null; then
    echo "$bin not found on PATH. install: brew install $bin" >&2
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon not reachable. start Docker Desktop first." >&2
  exit 1
fi

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "==> kind cluster '$CLUSTER' already exists"
else
  echo "==> creating kind cluster '$CLUSTER'"
  kind create cluster --name "$CLUSTER" --wait 120s
fi

kubectl --context "$CONTEXT" cluster-info >/dev/null

echo "==> applying agent-sandbox manifest ($VERSION)"
kubectl --context "$CONTEXT" apply --server-side \
  -f "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${VERSION}/manifest.yaml"

echo "==> applying agent-sandbox extensions ($VERSION)"
kubectl --context "$CONTEXT" apply --server-side \
  -f "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${VERSION}/extensions.yaml"

echo "==> waiting for controller rollout"
kubectl --context "$CONTEXT" -n agent-sandbox-system rollout status \
  deploy --timeout=5m

SANDBOX_IMAGE="${SANDBOX_IMAGE:-harness-sandbox:1}"
SANDBOX_DOCKERFILE_DIR="$HERE/../sandbox"
if [ -f "$SANDBOX_DOCKERFILE_DIR/Dockerfile" ]; then
  if ! docker image inspect "$SANDBOX_IMAGE" >/dev/null 2>&1; then
    echo "==> building $SANDBOX_IMAGE (no local image found)"
    docker build -t "$SANDBOX_IMAGE" "$SANDBOX_DOCKERFILE_DIR"
  fi
  echo "==> loading $SANDBOX_IMAGE into kind cluster '$CLUSTER'"
  kind load docker-image "$SANDBOX_IMAGE" --name "$CLUSTER"
fi

echo "==> smoke test: hello-world Sandbox (alpine)"
kubectl --context "$CONTEXT" delete sandbox hello-world --ignore-not-found --wait=true >/dev/null
kubectl --context "$CONTEXT" apply -f - <<'YAML'
apiVersion: agents.x-k8s.io/v1alpha1
kind: Sandbox
metadata:
  name: hello-world
spec:
  podTemplate:
    spec:
      containers:
      - name: my-container
        image: alpine:3.20
        command: ["sh","-c","echo OK_FROM_AGENT_SANDBOX && sleep 3600"]
      restartPolicy: Never
YAML

echo "==> waiting for sandbox pod"
for _ in $(seq 1 60); do
  phase=$(kubectl --context "$CONTEXT" get pod hello-world \
    -o jsonpath='{.status.phase}' 2>/dev/null || true)
  [ "$phase" = "Running" ] && break
  sleep 2
done
if [ "${phase:-}" != "Running" ]; then
  echo "FAIL: hello-world pod did not reach Running (phase=${phase:-missing})" >&2
  kubectl --context "$CONTEXT" describe sandbox hello-world || true
  kubectl --context "$CONTEXT" describe pod hello-world || true
  exit 1
fi

kubectl --context "$CONTEXT" logs hello-world -c my-container
kubectl --context "$CONTEXT" delete sandbox hello-world --wait=false >/dev/null
echo "==> done. context: $CONTEXT"
