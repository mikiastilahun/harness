#!/usr/bin/env bash
set -euo pipefail

PROFILE="${COLIMA_PROFILE:-harness}"
CONTEXT="colima-${PROFILE}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SANDBOX_DIR="$HERE/../sandbox"
SANDBOX_TAG="${SANDBOX_TAG:-harness-sandbox:1}"

if ! command -v colima >/dev/null; then
  echo "colima missing. install: brew install colima"
  exit 1
fi

if ! colima list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$PROFILE"; then
  echo "==> creating colima profile '$PROFILE' with nested virt + k3s + containerd"
  colima start --profile "$PROFILE" --kubernetes --runtime containerd \
    --vm-type=vz --nested-virtualization \
    --cpu 4 --memory 8 --disk 60
else
  echo "==> colima profile '$PROFILE' already exists; ensuring it's running"
  colima start --profile "$PROFILE"
fi

echo "==> waiting for /dev/kvm in the VM"
colima ssh -p "$PROFILE" -- test -e /dev/kvm || {
  echo "FAIL: /dev/kvm not present. nested virtualization didn't surface."
  exit 1
}

echo "==> applying kata RBAC + DaemonSet (kata-containers 3.13.0)"
kubectl --context "$CONTEXT" apply -k \
  "github.com/kata-containers/kata-containers/tools/packaging/kata-deploy/kata-rbac/base?ref=3.13.0"
kubectl --context "$CONTEXT" apply -k \
  "github.com/kata-containers/kata-containers/tools/packaging/kata-deploy/kata-deploy/overlays/k3s?ref=3.13.0"

echo "==> pinning image, enabling RuntimeClass creation"
kubectl --context "$CONTEXT" -n kube-system set image \
  ds/kata-deploy kube-kata=quay.io/kata-containers/kata-deploy:3.13.0
kubectl --context "$CONTEXT" -n kube-system set env \
  ds/kata-deploy CREATE_RUNTIMECLASSES=true

echo "==> waiting for kata-deploy rollout"
kubectl --context "$CONTEXT" -n kube-system rollout status ds/kata-deploy --timeout=10m

echo "==> wiring kata into /etc/containerd/config.toml"
colima ssh -p "$PROFILE" -- sudo tee /etc/containerd/config.toml >/dev/null < "$HERE/containerd-config.toml"
colima ssh -p "$PROFILE" sudo systemctl restart containerd
sleep 4

echo "==> building sandbox image '$SANDBOX_TAG' inside the VM"
colima ssh -p "$PROFILE" -- sudo mkdir -p /opt/harness/sandbox
cat "$SANDBOX_DIR/Dockerfile" | colima ssh -p "$PROFILE" -- sudo tee /opt/harness/sandbox/Dockerfile >/dev/null
colima ssh -p "$PROFILE" <<EOF
set -e
cd /opt/harness/sandbox
sudo nerdctl --namespace=k8s.io build -t $SANDBOX_TAG .
sudo nerdctl --namespace=k8s.io images | grep harness-sandbox
EOF

echo "==> smoke test under kata-clh"
kubectl --context "$CONTEXT" delete pod kata-smoke --ignore-not-found --wait=true >/dev/null
kubectl --context "$CONTEXT" run kata-smoke --image=alpine:3.20 --restart=Never \
  --overrides='{"spec":{"runtimeClassName":"kata-clh"}}' \
  -- sh -c 'uname -r; echo OK_FROM_KATA' >/dev/null
for _ in $(seq 1 60); do
  phase=$(kubectl --context "$CONTEXT" get pod kata-smoke -o jsonpath='{.status.phase}' 2>/dev/null)
  [ "$phase" = "Succeeded" ] && break
  [ "$phase" = "Failed" ] && break
  sleep 2
done
kubectl --context "$CONTEXT" logs kata-smoke
kubectl --context "$CONTEXT" delete pod kata-smoke --wait=false >/dev/null
echo "==> done"
