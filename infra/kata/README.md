# kata sandbox (local, Apple Silicon)

Real kata-containers running locally on macOS via Colima → Lima → Apple Virtualization.framework with nested virtualization → k3s + containerd 2.x + cloud-hypervisor.

Verified on M4 Pro, macOS 26.5, Colima 0.10.1. Requires M3+ silicon (nested virt support).

## One-time setup

```sh
./infra/kata/setup.sh
```

Or step by step:

```sh
# 1. Boot a Linux VM with nested virtualization + k3s on containerd
colima start \
  --profile harness \
  --kubernetes \
  --runtime containerd \
  --vm-type=vz \
  --nested-virtualization \
  --cpu 4 --memory 8 --disk 60

# 2. Install kata RBAC + DaemonSet (k3s overlay, pinned)
kubectl --context colima-harness apply \
  -k "github.com/kata-containers/kata-containers/tools/packaging/kata-deploy/kata-rbac/base?ref=3.13.0"

kubectl --context colima-harness apply \
  -k "github.com/kata-containers/kata-containers/tools/packaging/kata-deploy/kata-deploy/overlays/k3s?ref=3.13.0"

# Pin to a working tag and enable RuntimeClass creation
kubectl --context colima-harness -n kube-system set image \
  ds/kata-deploy kube-kata=quay.io/kata-containers/kata-deploy:3.13.0
kubectl --context colima-harness -n kube-system set env \
  ds/kata-deploy CREATE_RUNTIMECLASSES=true
kubectl --context colima-harness -n kube-system rollout status ds/kata-deploy --timeout=10m

# 3. Wire kata runtimes into containerd 2.x config (Colima uses external containerd,
#    so kata-deploy's k3s-embedded-containerd path doesn't apply).
#    See infra/kata/containerd-config.toml — apply with:
colima ssh -p harness -- "sudo tee /etc/containerd/config.toml" \
  < infra/kata/containerd-config.toml
colima ssh -p harness sudo systemctl restart containerd

# 4. Smoke test
kubectl --context colima-harness run kata-smoke --image=alpine:3.20 \
  --restart=Never \
  --overrides='{"spec":{"runtimeClassName":"kata-clh"}}' \
  -- uname -a
```

The container should report a kernel version *different* from the host VM kernel
(`uname -r` on the host VM is 6.8.x; the kata guest will be 6.12.x). That difference
is proof the container is running inside its own micro-VM.

## Notes

- `kata-clh` (cloud-hypervisor) is the default; we picked it because it boots fastest.
  Alternatives configured: `kata-qemu`, `kata-fc` (firecracker).
- Colima persists VM state across restarts, but **not** `/etc/containerd/config.toml` — it's reset to a 2-line stub on every `colima stop` / `colima start` cycle. Run `pnpm sandbox:up` (or `./infra/kata/start.sh`) after starting colima; it re-applies the kata stanzas and restarts containerd if (and only if) they're missing. The script avoids `colima ssh` (which can fail on user-rc issues) by writing through the `kata-deploy` pod's host mount and `nsenter`-ing into PID 1 to restart containerd.
- If you recreate the VM (`colima delete --data`), you must redo `setup.sh`.
- The `kata-deploy` DaemonSet writes to `/opt/kata/containerd/config.d/kata-deploy.toml` on every restart, but since Colima's external containerd doesn't load that drop-in dir, we keep the kata stanzas in `/etc/containerd/config.toml` directly.
