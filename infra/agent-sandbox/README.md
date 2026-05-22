# agent-sandbox

Sandbox runtime for the harness API: each session gets a pod managed by the
upstream [`agent-sandbox`](https://agent-sandbox.sigs.k8s.io/) controller.
The provider in `apps/api/src/sandbox/provider.ts` creates/deletes `Sandbox`
custom resources; the controller materializes them as pods we `exec` into.

Two ways to run the controller:

| | qa1 GKE (default) | local kind |
|---|---|---|
| Cluster | `qa1-us-central1-services` (project `qa1-us-central1-vpc-63b3e2`) | `kind` (docker container) |
| Context | `gke_qa1-us-central1-vpc-63b3e2_us-central1_qa1-us-central1-services` | `kind-harness-agent-sandbox` |
| Sandbox image | `us-docker.pkg.dev/mgmt-us-central1-vpc-a2cc50/apps/harness-sandbox:1` (mgmt apps repo) | `harness-sandbox:1` (local; `kind load`) |
| Controller install | ACM ConfigSync from `infrastructure/acm/config-root/qa1-us-central1/agent-sandbox/` | `./infra/agent-sandbox/setup.sh` |
| Use case | shared dev / staging | hacking offline |

## qa1 GKE (default)

The controller, its CRDs, and the `harness-sandboxes` namespace are managed by
ConfigSync via the infrastructure repo. To use the cluster:

```sh
gcloud container clusters get-credentials qa1-us-central1-services \
  --region us-central1 --project qa1-us-central1-vpc-63b3e2

# .env already points here by default.
pnpm dev
```

Sanity-check the controller:

```sh
CTX=gke_qa1-us-central1-vpc-63b3e2_us-central1_qa1-us-central1-services
kubectl --context $CTX -n agent-sandbox-system get pods
kubectl --context $CTX -n harness-sandboxes get sandboxes
```

### Rebuilding the sandbox image

The sandbox image lives in the shared mgmt `apps` Artifact Registry; the qa1
node service account already has `roles/artifactregistry.reader` on it (managed
by Terramate in
`stacks/mgmt-us-central1/mgmt-us-central1-vpc/artifact-registry/stack.tm.hcl`).
No imagePullSecret required.

```sh
gcloud auth configure-docker us-docker.pkg.dev  # one-time

docker buildx build --platform linux/amd64 --provenance=false --push \
  -t us-docker.pkg.dev/mgmt-us-central1-vpc-a2cc50/apps/harness-sandbox:1 \
  -t us-docker.pkg.dev/mgmt-us-central1-vpc-a2cc50/apps/harness-sandbox:latest \
  infra/sandbox
```

### Bumping the controller version

Manifests are vendored at
`infrastructure/acm/config-root/qa1-us-central1/agent-sandbox/`. To bump:

```sh
cd infrastructure/acm/config-root/qa1-us-central1/agent-sandbox
V=v0.4.7
curl -fsSL -o manifest.yaml   https://github.com/kubernetes-sigs/agent-sandbox/releases/download/$V/manifest.yaml
curl -fsSL -o extensions.yaml https://github.com/kubernetes-sigs/agent-sandbox/releases/download/$V/extensions.yaml
# Then drop the controller Deployment from manifest.yaml — extensions.yaml's
# copy (the one with --extensions) is the authoritative one. See the comment in
# kustomization.yaml.
kubectl kustomize . > /dev/null  # validates build
```

Commit + push the infrastructure repo; ConfigSync reconciles within a minute.

## Local kind (offline dev)

```sh
./infra/agent-sandbox/setup.sh    # one-shot: kind cluster + controller + CRDs + smoke test
pnpm sandbox:up                   # every boot: docker start of the kind node
pnpm sandbox:down                 # docker stop
```

Override these in `.env` to point the API at the local cluster:

```sh
SANDBOX_CONTEXT=kind-harness-agent-sandbox
SANDBOX_IMAGE=harness-sandbox:1
```

`setup.sh` builds `infra/sandbox/Dockerfile` as `harness-sandbox:1` and
`kind load`s it into the cluster, so the local default works without a registry.

## Try it (either backend)

```sh
kubectl --context "$SANDBOX_CONTEXT" apply -f - <<'YAML'
apiVersion: agents.x-k8s.io/v1alpha1
kind: Sandbox
metadata:
  name: scratch
  namespace: harness-sandboxes
spec:
  podTemplate:
    spec:
      containers:
      - name: shell
        image: python:3.12-slim-bookworm
        command: ["sleep","infinity"]
      restartPolicy: Never
YAML

kubectl --context "$SANDBOX_CONTEXT" -n harness-sandboxes exec -it scratch -c shell -- bash
kubectl --context "$SANDBOX_CONTEXT" -n harness-sandboxes delete sandbox scratch
```

## Notes

- The provider creates `Sandbox` CRs at runtime in `harness-sandboxes`; only
  the namespace itself is in ACM, not individual sandboxes.
- Optional `SANDBOX_RUNTIME_CLASS=kata-clh|gvisor` if you've installed those
  runtimes. Stock GKE only ships gVisor on sandbox-enabled node pools — leave
  unset for now.
