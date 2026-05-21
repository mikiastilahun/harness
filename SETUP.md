# Setup — running harness on another machine

The lean path: install prereqs, bring up the cluster, run.

The sandbox runs inside a local Kubernetes cluster ([kind](https://kind.sigs.k8s.io/))
with the [agent-sandbox](https://agent-sandbox.sigs.k8s.io/) controller installed.
Each chat in the UI gets its own pod via a `Sandbox` custom resource. Chats are
stored in browser `localStorage` — there's no database, no sign-in.

---

## 1. Prerequisites

| Tool | macOS | Linux |
|---|---|---|
| **Docker** (Desktop or daemon) | https://www.docker.com/products/docker-desktop/ | distro package |
| **kind** ≥ 0.30 | `brew install kind` | https://kind.sigs.k8s.io/docs/user/quick-start/#installation |
| **kubectl** | `brew install kubectl` | distro package or upstream binary |
| **pnpm** ≥ 10 | `brew install pnpm` or `corepack enable` | `corepack enable` |
| **Node** 22 LTS | `brew install node@22` or `nvm install 22` | nvm / distro package |
| **gcloud CLI** | `brew install --cask google-cloud-sdk` | https://cloud.google.com/sdk/docs/install |

Confirm Docker is running:

```sh
docker info >/dev/null && echo "docker ok"
```

You also need a **Google Cloud project** with the **Vertex AI API enabled**.

---

## 2. Clone & install

```sh
git clone git@github.com:mikiastilahun/harness.git
cd harness
pnpm install
```

---

## 3. Vertex AI (Gemini) — Application Default Credentials

```sh
gcloud auth application-default login
gcloud config set project YOUR_GCP_PROJECT_ID
gcloud services enable aiplatform.googleapis.com
```

ADC is written to `~/.config/gcloud/application_default_credentials.json` and
picked up automatically by `@ai-sdk/google-vertex`.

---

## 4. `.env`

```sh
cp .env.example .env
```

Set `GOOGLE_VERTEX_PROJECT` to your project id. The other defaults
(`SANDBOX_CONTEXT=kind-harness-agent-sandbox`, …) match what step 5 creates.

---

## 5. Provision the sandbox cluster (kind + agent-sandbox)

```sh
./infra/agent-sandbox/setup.sh
```

Idempotent (re-run safely). It does:

1. Creates kind cluster `harness-agent-sandbox` (~30s cold; instant if it exists).
2. Installs the agent-sandbox controller + CRDs (pinned `v0.4.6`).
3. Builds `infra/sandbox/Dockerfile` as `harness-sandbox:1` (Debian + Python
   stack + ripgrep + node) and `kind load`s it into the cluster.
4. Smoke-tests with a hello-world `Sandbox` CR.

You should see `OK_FROM_AGENT_SANDBOX` at the end.

**Verify:**

```sh
kubectl --context kind-harness-agent-sandbox get crd | grep agents.x-k8s.io
kubectl --context kind-harness-agent-sandbox -n agent-sandbox-system get deploy
```

---

## 6. Run

```sh
pnpm dev
```

- API: <http://localhost:8787>
- Web: <http://localhost:5173>

Open the web URL. No sign-in. Try:

> *"Use your bash tool to run `hostname; uname -a` and show me the result."*

The hostname returned will start with `harness-sb-…` — that's the per-session
sandbox pod.

---

## Daily workflow

| What | Command |
|---|---|
| Bring everything up | `pnpm sandbox:up && pnpm dev` |
| Stop the cluster (keeps state) | `pnpm sandbox:down` |
| Wipe the cluster | `kind delete cluster --name harness-agent-sandbox` |
| Tail sandbox activity | `watch -n1 'kubectl --context kind-harness-agent-sandbox -n harness-sandboxes get sandbox,pod'` |
| Exec into a session pod | `kubectl --context kind-harness-agent-sandbox -n harness-sandboxes exec -it harness-sb-<sessionId> -c shell -- bash` |
| Delete stale session pods | `kubectl --context kind-harness-agent-sandbox -n harness-sandboxes delete sandbox --all` |
| Clear all chats (browser) | open devtools → Application → Local Storage → delete `harness.*` keys |

`pnpm sandbox:up` just starts the kind docker container; it doesn't re-apply
manifests. For a controller upgrade, re-run `./infra/agent-sandbox/setup.sh`.

---

## Troubleshooting

### `kind create cluster` fails or hangs
- Confirm Docker is running: `docker info`
- On macOS with low memory, raise Docker Desktop's memory to ≥ 4 GB.

### Sandbox pod stays `Pending` / `ImagePullBackOff`
The default image (`harness-sandbox:1`) only exists inside the kind cluster
after `setup.sh` runs. If you wiped the cluster, re-run
`./infra/agent-sandbox/setup.sh` to rebuild and reload it. To use a public
image instead, set in `.env`:

```sh
SANDBOX_IMAGE=python:3.12-slim-bookworm
SANDBOX_IMAGE_PULL_POLICY=IfNotPresent
```

Note: the tool prompt advertises numpy/pandas/etc. — those only exist in
`harness-sandbox:1`. With a stock image the agent can `pip_install` them.

### Chat says "no API key" or Vertex errors
- `gcloud auth application-default print-access-token` — should print a token.
  If not, re-run `gcloud auth application-default login`.
- Confirm `GOOGLE_VERTEX_PROJECT` in `.env` matches a project where Vertex AI
  is enabled.
- For Gemini 3 preview models, set `GOOGLE_VERTEX_LOCATION=global`.

### Provider hits `Unauthorized` calling k8s
Your kubeconfig is missing the `kind-harness-agent-sandbox` context. Run
`kind get clusters` — if `harness-agent-sandbox` is listed, run
`kind export kubeconfig --name harness-agent-sandbox` to regenerate the entry.

---

## What runs where

```
host (your laptop)
├─ pnpm dev
│  ├─ apps/api    Node 22 + tsx        →  :8787
│  └─ apps/web    Vite (SvelteKit)     →  :5173
├─ docker
│  └─ harness-agent-sandbox-control-plane   (kind node, holds the cluster)
│     └─ k8s
│        ├─ agent-sandbox-system/   controller + CRDs
│        └─ harness-sandboxes/      one Sandbox CR + pod per chat
└─ Vertex AI (Gemini)                  via ADC, no local state
```

Chat history lives in browser `localStorage` under the `harness.*` namespace.
Closing/reopening the tab restores your chats. Clearing site data clears them.
