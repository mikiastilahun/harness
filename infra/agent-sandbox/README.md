# agent-sandbox (local, kind)

Runs the upstream [`agent-sandbox`](https://agent-sandbox.sigs.k8s.io/)
controller on a local [kind](https://kind.sigs.k8s.io/) cluster
(Kubernetes-in-Docker). Each chat session in the harness gets its own pod
through a `Sandbox` custom resource. Works on any host with Docker and kind
installed.

## One-time setup

```sh
./infra/agent-sandbox/setup.sh
```

Idempotent. Provisions:

1. `kind` cluster named `harness-agent-sandbox` (override with `KIND_CLUSTER=`).
2. `agent-sandbox` controller + CRDs (pinned to `v0.4.6` —
   override with `AGENT_SANDBOX_VERSION=`).
3. Extensions (`SandboxTemplate`, etc.).
4. Builds `infra/sandbox/Dockerfile` as `harness-sandbox:1` and `kind load`s
   it into the cluster, so the default `SANDBOX_IMAGE` works without a
   registry.
5. Smoke test: applies a hello-world `Sandbox` CR running `alpine`, prints
   its logs, deletes it.

## Every-boot

```sh
pnpm sandbox:up    # docker start <node-container> + wait for controller
```

kind nodes are just docker containers. Stopping Docker stops the cluster;
restarting Docker leaves it stopped until `sandbox:up` brings it back.

## Teardown

```sh
pnpm sandbox:down                            # stop the node container (state persists)
kind delete cluster --name harness-agent-sandbox   # fully wipe
```

## Try it

```sh
kubectl --context kind-harness-agent-sandbox apply -f - <<'YAML'
apiVersion: agents.x-k8s.io/v1alpha1
kind: Sandbox
metadata:
  name: scratch
spec:
  podTemplate:
    spec:
      containers:
      - name: shell
        image: python:3.12-slim-bookworm
        command: ["sleep","infinity"]
      restartPolicy: Never
YAML

kubectl --context kind-harness-agent-sandbox exec -it scratch -c shell -- bash
```

## Optional: Python SDK pieces

The upstream install docs also include a `sandbox-router` deployment and a
`python-sandbox-template` for use with the Python client SDK. We don't install
them by default because the harness is TypeScript. To add them:

```sh
VERSION=v0.4.6
SANDBOX_NAMESPACE=default
SANDBOX_TEMPLATE_NAME=python-sandbox

# router
curl -sSL "https://raw.githubusercontent.com/kubernetes-sigs/agent-sandbox/refs/tags/${VERSION}/clients/python/agentic-sandbox-client/sandbox-router/sandbox_router.yaml" \
  | sed 's|${ROUTER_IMAGE}|us-central1-docker.pkg.dev/k8s-staging-images/agent-sandbox/sandbox-router:latest-main|g' \
  | kubectl --context kind-harness-agent-sandbox apply -f -

# template
curl -sSL "https://raw.githubusercontent.com/kubernetes-sigs/agent-sandbox/refs/tags/${VERSION}/clients/python/agentic-sandbox-client/python-sandbox-template.yaml" \
  | sed -e "s|\${SANDBOX_NAMESPACE}|${SANDBOX_NAMESPACE}|g" \
        -e "s|\${SANDBOX_TEMPLATE_NAME}|${SANDBOX_TEMPLATE_NAME}|g" \
  | kubectl --context kind-harness-agent-sandbox apply -f -
```

## Notes

- `apps/api/src/sandbox/provider.ts` creates `Sandbox` CRs in this cluster by
  default (`SANDBOX_CONTEXT=kind-harness-agent-sandbox`,
  `SANDBOX_NAMESPACE=harness-sandboxes`).
- `kind` images are kubernetes-version-tagged. Override with `--image` on
  `kind create cluster` if you need a specific k8s version; the default tracks
  the kind release.
