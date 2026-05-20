# Production architecture (single Linux VPS)

This document describes how to deploy `harness` to a single Linux VPS. It assumes you
own a domain, can put DNS records on it, and have a Google OAuth client. It is
opinionated where the alternatives are roughly equivalent.

If you are evaluating a hosting target other than a VPS (Fly.io machines, a Kubernetes
cluster, separate boxes per component) see the "Variants" section at the end.

---

## 1. Goals

- One public origin (`https://app.example.com`) serves everything.
- The Hono API and Postgres are **not** reachable from the public internet.
- User-supplied LLM API keys are encrypted at rest with AES-256-GCM.
- Code execution happens inside a **kata-containers** micro-VM, not a plain Linux
  container. The host kernel is never the boundary an attacker hits first.
- A single `git pull && systemctl restart harness-*` updates the app.
- Logs and DB volume survive process restarts and OS upgrades.

The sandbox isolation goal is the reason this design is opinionated about k3s + kata.
If you remove that, you can run a much simpler stack (just two systemd units +
Postgres + reverse proxy) — see "Variant A: no sandbox".

---

## 2. Topology

Everything runs on one VPS. Logical boundaries (not separate hosts):

```mermaid
flowchart TB
  subgraph Internet
    Browser["Browser<br/>app.example.com"]
  end

  subgraph VPS["Linux VPS (single host)"]
    direction TB

    Caddy["Caddy<br/>:80 / :443<br/>auto-TLS via Let's Encrypt"]

    subgraph Node["Node 22 user processes"]
      Web["@harness/web<br/>SvelteKit (adapter-node)<br/>127.0.0.1:3000"]
      API["@harness/api<br/>Hono / @hono/node-server<br/>127.0.0.1:8787"]
    end

    PG["Postgres 17<br/>127.0.0.1:5432<br/>volume: /var/lib/postgresql"]

    subgraph K3S["k3s (containerd 2.x, kata-clh runtime)"]
      direction LR
      KAPI["k3s API server<br/>127.0.0.1:6443"]
      NS["namespace: harness-sandboxes"]
      Pod1["sandbox pod<br/>(per-session kata micro-VM)"]
      NS --> Pod1
      KAPI --- NS
    end

    Browser -->|"HTTPS"| Caddy
    Caddy -->|"reverse proxy<br/>HTTP/1.1 + WS"| Web
    Web -->|"BFF: /api/*, /auth/*<br/>cookie passthrough"| API
    API --> PG
    API -->|"@kubernetes/client-node<br/>via kubeconfig"| KAPI
    KAPI --> Pod1
  end

  Browser -.->|"OAuth (Google)"| Google["accounts.google.com"]
  Google -.->|"redirect to<br/>/api/auth/callback/google"| Caddy
```

**Why one box:** all three Node processes (Caddy, Web, API) idle under 200 MB; k3s
+ kata adds 800 MB – 1.5 GB baseline; Postgres tiny. A 4-vCPU, 8 GB VPS handles
this with room to run several concurrent sandbox VMs. Splitting the API from the
sandbox host is cheap to do later (the API talks to the sandbox over kubectl —
literally a kubeconfig URL change).

---

## 3. Components

### 3.1 Caddy (TLS termination + reverse proxy)

- Public ingress. Listens on `:80` and `:443`.
- Automatic HTTPS via Let's Encrypt (no certbot required).
- Reverse-proxies all paths to the SvelteKit process on `127.0.0.1:3000`.
- `:80` only exists to serve the ACME challenge and 301 to HTTPS.

`/etc/caddy/Caddyfile`:

```caddy
app.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000 {
    flush_interval -1   # streaming response (chat SSE-ish)
  }
}
```

`flush_interval -1` is critical — without it Caddy buffers the streaming response
from `streamText()` and the chat UI appears to hang until the assistant finishes.

### 3.2 `@harness/web` (SvelteKit, adapter-node)

- Built artifact: `apps/web/build/index.js`.
- Listens on `127.0.0.1:3000` (env: `HOST=127.0.0.1 PORT=3000`).
- Hosts the UI **and** the BFF (`/api/*`, `/api/auth/*`).
- The BFF forwards to the API, including cookies in both directions — see
  `apps/web/src/lib/proxy.ts`. This is what lets cookies be first-party on
  `app.example.com`.
- Reads `PUBLIC_BASE_URL` (e.g. `https://app.example.com`) so the better-auth
  Svelte client can resolve absolute URLs during SSR.

### 3.3 `@harness/api` (Hono on Node 22)

- Entry: `apps/api/src/index.ts` via `node --import tsx`.
- Listens on `127.0.0.1:8787`. **Never expose this port publicly.**
- Routes:
  - `/api/auth/*` — better-auth handler (Google OAuth + sessions)
  - `/chat`, `/sandbox/*`, `/threads/*`, `/settings/*` — all gated by
    `requireAuth` middleware that resolves the session via cookies forwarded
    from the BFF.
- Talks to Postgres (drizzle-orm + `pg`) and to k3s (`@kubernetes/client-node`
  reading `/etc/rancher/k3s/k3s.yaml`).
- Builds AI SDK provider clients **per request** using the user's decrypted
  API key. No keys are held in memory between requests.

### 3.4 Postgres 17

- Listens on `127.0.0.1:5432` (no `listen_addresses = '*'`).
- Owns four tables for auth (`user`, `session`, `account`, `verification`),
  plus `thread` and `user_settings`. See `apps/api/drizzle/`.
- Data volume mounted at `/var/lib/postgresql`. Daily `pg_dump` to `/var/backups/`
  via cron; off-host copy via your favourite tool (`rclone`, `restic`, S3 CLI).

### 3.5 k3s + kata-containers (sandbox runtime)

- k3s is a single-binary lightweight Kubernetes distribution; runs as a systemd
  service. The API server binds to `127.0.0.1:6443`.
- `kata-deploy` DaemonSet installs the kata binaries + creates the `kata-clh`
  RuntimeClass.
- `/etc/containerd/config.toml` registers the kata runtimes for containerd. On a
  Linux host this file is **not** rewritten across reboots (unlike Colima), so
  the `pnpm sandbox:up` shim is not needed in production — see "Differences from
  the macOS dev setup".
- Sandbox image (`harness-sandbox:1`) is built once with
  `nerdctl --namespace=k8s.io build` and persisted in containerd's image store.
- Pods are scheduled in namespace `harness-sandboxes`, one per chat session,
  with `runtimeClassName: kata-clh`.

**Nested virt requirement.** Most KVM-based VPS providers (Hetzner Cloud,
DigitalOcean Premium, OVH, Vultr High Frequency) expose `/dev/kvm` to the guest.
Verify with `ls /dev/kvm` before committing. If not available, see "Variant B:
gVisor instead of kata".

### 3.6 Sandbox image

- Lives at `infra/sandbox/Dockerfile`.
- Built once, imported into containerd:
  ```sh
  sudo nerdctl --namespace=k8s.io build -t harness-sandbox:1 infra/sandbox
  ```
- Tag is referenced from `apps/api/src/sandbox/provider.ts` via the
  `SANDBOX_IMAGE` env var.

---

## 4. Request flows

### 4.1 Sign-in (Google OAuth)

```
1. Browser → GET https://app.example.com/signin                  (Caddy → Web)
2. Browser → POST /api/auth/sign-in/social { provider: "google" }
              Web BFF → API /api/auth/sign-in/social
              better-auth returns 302 to accounts.google.com
              with redirect_uri=https://app.example.com/api/auth/callback/google
3. Browser → accounts.google.com  (out of band)
4. Google  → 302 https://app.example.com/api/auth/callback/google?code=…
              Caddy → Web BFF → API
              API exchanges code with Google, upserts user + session,
              Set-Cookie: better-auth.session_token=…
              302 to /chat
5. Browser stores cookie on app.example.com (first-party).
```

**Important configuration:**

- `BETTER_AUTH_URL=https://app.example.com` (NOT the API URL).
- Google Cloud Console → OAuth client → Authorized redirect URIs must include
  `https://app.example.com/api/auth/callback/google`.
- `trustedOrigins: [WEB_URL]` already covers this in `apps/api/src/auth.ts`.

### 4.2 Chat send

```
Browser  POST /api/chat { messages, model: "google:gemini-2.5-pro", sessionId }
         + Cookie: better-auth.session_token=…
   ↓
Caddy → Web BFF (forwards body + cookie, duplex: half for streaming request)
   ↓
API   /chat → requireAuth → getSession({ headers }) → ok
          → SELECT * FROM user_settings WHERE user_id = ?
          → decrypt(google_api_key)
          → buildModel("google", "gemini-2.5-pro", apiKey)
          → streamText({ model, messages, tools: sandboxTools(sessionId), … })
   ↓ (UI message stream, SSE-ish)
Caddy passes through with flush_interval -1
   ↓
Browser renders parts as they arrive
```

When `streamText` invokes a sandbox tool (e.g. `bash`), `sandboxTools()` reaches
into k3s via `@kubernetes/client-node`, creates/reuses a pod under
`harness-sandboxes`, and runs the command via the k8s exec API. Output streams
back as a tool-call part in the same UI stream.

---

## 5. Network model

| Layer            | Listens on                          | Reachable from         |
|------------------|-------------------------------------|------------------------|
| Caddy            | `0.0.0.0:80`, `0.0.0.0:443`         | Internet               |
| SvelteKit        | `127.0.0.1:3000`                    | localhost (Caddy)      |
| Hono API         | `127.0.0.1:8787`                    | localhost (Web)        |
| Postgres         | `127.0.0.1:5432`                    | localhost (API)        |
| k3s API          | `127.0.0.1:6443`                    | localhost (API)        |
| kata pods        | cluster-internal                    | k3s only               |

Firewall (ufw on Ubuntu / Debian):

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp     # SSH (consider port-knocking or Tailscale instead)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

SSH should be key-only (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).
Strongly consider putting SSH behind Tailscale instead of exposing `:22`.

---

## 6. Storage

| Path                                 | Owner          | Purpose                                  | Backup?           |
|--------------------------------------|----------------|------------------------------------------|-------------------|
| `/var/lib/postgresql`                | `postgres`     | All app DB state                         | **Yes**, daily    |
| `/var/lib/rancher/k3s`               | `root`         | k3s state, containerd image store        | No (rebuildable)  |
| `/etc/rancher/k3s/k3s.yaml`          | `root`         | kubeconfig — API server uses this        | **Yes**, once     |
| `/opt/harness`                       | `harness` user | Source checkout, build artifacts         | git is authority  |
| `/opt/harness/.env`                  | `harness` user | Secrets                                  | **Yes, securely** |
| `/var/log/caddy`, `/var/log/journal` | system         | Logs                                     | No                |

### Postgres backup cron

`/etc/cron.daily/harness-pg-dump`:

```sh
#!/bin/sh
set -e
DEST=/var/backups/harness
TS=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$DEST"
sudo -u postgres pg_dump -Fc harness > "$DEST/harness-$TS.dump"
find "$DEST" -name 'harness-*.dump' -mtime +14 -delete
```

Then sync `/var/backups/harness` off-host (S3, B2, another VPS). The encryption
key (`BETTER_AUTH_SECRET`) is **not** in the DB dump — it lives in `.env`. If
you lose `.env`, the encrypted API key columns become unrecoverable. Back both
up together, separately encrypted.

---

## 7. Secrets and configuration

All app config lives in `/opt/harness/.env`. The file is owned by the `harness`
user, mode `600`.

```env
# Public origin (what the browser sees)
WEB_URL=https://app.example.com
PUBLIC_BASE_URL=https://app.example.com

# Internal endpoints
API_URL=http://127.0.0.1:8787
API_PORT=8787

# Postgres
DATABASE_URL=postgres://harness:STRONG_PG_PASSWORD@127.0.0.1:5432/harness

# better-auth
BETTER_AUTH_URL=https://app.example.com
BETTER_AUTH_SECRET=BASE64_32_BYTES_HERE   # openssl rand -base64 32

# Google OAuth (login provider; not Vertex AI)
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# Kata sandbox
KATA_CONTEXT=default                  # k3s kubeconfig context name
KATA_NAMESPACE=harness-sandboxes
KATA_RUNTIME_CLASS=kata-clh
SANDBOX_IMAGE=harness-sandbox:1
SANDBOX_IMAGE_PULL_POLICY=IfNotPresent
KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

**Rotating `BETTER_AUTH_SECRET`** invalidates all sessions (forces re-login) **and**
makes encrypted columns unreadable. If you want to rotate without locking out
users:

1. Read every `user_settings` row with the old secret, decrypt each key,
2. Set the new secret,
3. Re-encrypt and write back.
4. Force-expire sessions (DELETE FROM session).

A short script for this lives at `infra/ops/rotate-secret.ts` (TODO — write
this once you actually need to rotate).

---

## 8. TLS and DNS

1. Point an `A` record (and `AAAA` if IPv6) for `app.example.com` to the VPS IP.
2. Make sure `:80` and `:443` are open in the cloud provider's firewall AND in
   ufw.
3. Start Caddy. It will obtain a certificate within ~10 seconds and persist it
   under `/var/lib/caddy/`.

For Google OAuth, only the **exact** redirect URI listed in the Cloud Console
will be accepted by Google. Add both `http://localhost:5173/api/auth/callback/google`
(dev) and `https://app.example.com/api/auth/callback/google` (prod).

---

## 9. systemd units

The app runs as four services. All `Restart=always` so they come back after a
reboot or after either crashes.

### `/etc/systemd/system/harness-api.service`

```ini
[Unit]
Description=harness API (Hono on Node 22)
After=network-online.target postgresql.service k3s.service
Wants=postgresql.service k3s.service

[Service]
User=harness
WorkingDirectory=/opt/harness/apps/api
EnvironmentFile=/opt/harness/.env
ExecStart=/usr/bin/node --env-file=/opt/harness/.env --import tsx src/index.ts
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### `/etc/systemd/system/harness-web.service`

```ini
[Unit]
Description=harness Web (SvelteKit adapter-node)
After=network-online.target harness-api.service
Wants=harness-api.service

[Service]
User=harness
WorkingDirectory=/opt/harness/apps/web
EnvironmentFile=/opt/harness/.env
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=NODE_ENV=production
ExecStart=/usr/bin/node build/index.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### `/etc/systemd/system/caddy.service`

Use the package from Caddy's official apt repo — it installs a unit. Then:

```sh
sudo systemctl enable --now caddy
```

### `k3s.service`

Installed by the k3s installer (`curl -sfL https://get.k3s.io | sh -`). Already
a systemd service.

### Postgres

Use the distro package (`postgresql-17` on Debian 13 / Ubuntu 24.04). Already a
systemd service.

---

## 10. Initial deployment

A one-shot script outline lives in `infra/deploy/install.sh` (TODO). Steps:

```sh
# 0. Provision VPS (Ubuntu 24.04 LTS, 4 vCPU, 8 GB RAM, KVM-capable)
ssh root@vps

# 1. OS hardening
apt-get update && apt-get upgrade -y
apt-get install -y ufw fail2ban
ufw allow 22,80,443/tcp && ufw enable
# (configure /etc/ssh/sshd_config: PasswordAuthentication no)

# 2. Create app user
adduser --disabled-password --gecos "" harness
usermod -aG sudo harness

# 3. Postgres
apt-get install -y postgresql-17
sudo -u postgres createuser harness
sudo -u postgres createdb -O harness harness
sudo -u postgres psql -c "ALTER USER harness PASSWORD 'STRONG_PG_PASSWORD'"

# 4. Node 22 + pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
npm i -g pnpm@10

# 5. k3s
curl -sfL https://get.k3s.io | sh -
# (kata-deploy + RuntimeClass: see infra/kata/setup.sh — adapt for Linux,
# colima ssh is replaced with direct kubectl + nerdctl on the host)

# 6. Caddy
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
# (write /etc/caddy/Caddyfile, see §3.1)

# 7. Code
sudo -u harness git clone https://github.com/<you>/harness /opt/harness
cd /opt/harness
sudo -u harness pnpm install
sudo -u harness pnpm db:migrate
sudo -u harness pnpm --filter @harness/web build

# 8. systemd
cp infra/deploy/systemd/*.service /etc/systemd/system/
systemctl enable --now harness-api harness-web caddy
```

---

## 11. Differences from the macOS dev setup

| Concern                          | Dev (macOS)                                      | Prod (Linux VPS)                                  |
|----------------------------------|--------------------------------------------------|---------------------------------------------------|
| Linux VM                         | colima `harness` profile (Lima + VZ)             | Bare metal Linux — no VM needed                   |
| `/etc/containerd/config.toml`    | **Reset** by Colima on every stop/start          | Persists across reboots — no shim needed          |
| `pnpm sandbox:up`                | Required after every `colima start`              | Not needed                                        |
| Postgres                         | Docker (`infra/docker-compose.yml`)              | OS package (`postgresql-17`)                      |
| Dev process                      | `pnpm dev` (tsx --watch + vite dev)              | systemd units, built artifacts (`node build/...`) |
| OAuth redirect URI               | `http://localhost:5173/api/auth/callback/google` | `https://app.example.com/api/auth/callback/google`|
| Cookies                          | `Secure: false`, `SameSite: lax`                 | `Secure: true`, `SameSite: lax`                   |

The cookie change is automatic — `apps/api/src/auth.ts` already keys `secure` off
`NODE_ENV === "production"`. Set `NODE_ENV=production` in the systemd `EnvironmentFile`.

---

## 12. Updates and rollbacks

A typical release:

```sh
ssh harness@vps
cd /opt/harness
git fetch && git checkout <tag>
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm --filter @harness/web build
sudo systemctl restart harness-api harness-web
```

Wrap that in a one-liner script (`infra/deploy/release.sh`) and trigger from CI.

**Migrations are forward-only.** Drizzle generates migration SQL into
`apps/api/drizzle/`. Always apply migrations *before* restarting the API (the new
code may depend on the new schema). For destructive migrations, take a pg_dump
first.

**Rollback** = `git checkout <previous-tag>` and `systemctl restart`. If a
migration ran and the schema is now ahead of the rolled-back code, restore the
pg_dump.

---

## 13. Monitoring and logs

- Process logs: `journalctl -u harness-api -f` (or `-web`, `-caddy`, `-k3s`).
- Caddy access log: enable `log` block in Caddyfile if you want HTTP logs.
- Postgres slow queries: `log_min_duration_statement = 250` in
  `/etc/postgresql/17/main/postgresql.conf`.
- Sandbox pods: `kubectl -n harness-sandboxes get pods` and
  `kubectl -n harness-sandboxes logs <pod>`.

For external alerting on the cheap: a uptime check (UptimeRobot, Better Stack,
healthchecks.io) hitting `https://app.example.com/api/auth/get-session`. That
endpoint returns 200 with `null` for unauthenticated requests, so a non-200 is
a real problem (DB down, API crashed, Caddy misconfig).

For metrics, the AI SDK already exposes token usage on the stream-finish event;
plumb it through to `journalctl` or a metrics endpoint when you actually need
dashboards. Don't add Prometheus + Grafana until that point.

---

## 14. Hardening checklist

- [ ] SSH: key-only, `PasswordAuthentication no`, non-default port or Tailscale.
- [ ] ufw enabled, only `22/80/443` open.
- [ ] Unattended security upgrades (`unattended-upgrades` package).
- [ ] `harness` user is **not** in `sudo` after install; only root can manage
      systemd. (`usermod -G "" harness` to drop sudo group.)
- [ ] `.env` mode 600, owned by `harness:harness`.
- [ ] Postgres listens on 127.0.0.1 only; `pg_hba.conf` uses `scram-sha-256`.
- [ ] Daily `pg_dump` cron + off-host sync.
- [ ] `BETTER_AUTH_SECRET` is at least 32 bytes from `/dev/urandom`. Never
      commit it.
- [ ] Caddy TLS auto-renewal is verified once (`journalctl -u caddy | grep ACME`).
- [ ] Google OAuth client: production redirect URI added, dev URI removed if not
      needed, `quota project` reasonable.
- [ ] Sandbox image is built from the repo, not pulled from an external registry
      that could change.
- [ ] kata RuntimeClass enforced — every pod created by
      `apps/api/src/sandbox/provider.ts` sets `runtimeClassName: kata-clh`.
      Spot-check with `kubectl -n harness-sandboxes get pod -o jsonpath='{.items[*].spec.runtimeClassName}'`.

---

## 15. Sizing recommendations

| Concurrent active chat sessions | vCPU | RAM    | Disk    |
|----------------------------------|------|--------|---------|
| 1 – 5  (personal)                | 2    | 4 GB   | 40 GB   |
| 5 – 25 (small team)              | 4    | 8 GB   | 80 GB   |
| 25 – 100                         | 8    | 16 GB  | 160 GB  |

Each kata micro-VM defaults to 1 vCPU / 2 GB RAM. Tune
`/opt/kata/share/defaults/kata-containers/configuration-clh.toml`
(`default_vcpus`, `default_memory`) if your workloads need more or less.

Postgres: < 100 MB until you hit thousands of users, then grows with message
history. Most of your disk is `containerd` image cache (kata guest kernel +
rootfs + sandbox image ≈ 1.5 GB).

LLM calls dominate latency, not anything on your box. Don't over-provision based
on response time — measure first.

---

## 16. Variants

### Variant A: no sandbox

Drop k3s + kata entirely. Replace `apps/api/src/sandbox/provider.ts` with a
no-op or a Bun/Node child-process executor. You lose the security boundary but
gain: 1.5 GB less RAM baseline, no nested-virt requirement, fits comfortably on
a 2-vCPU / 2 GB VPS. Suitable if you trust every user (e.g. internal-only tool).

### Variant B: gVisor instead of kata

If your VPS provider does not expose `/dev/kvm`, you can swap the kata
RuntimeClass for `runsc` (gVisor). Weaker isolation than kata (it's a
userspace syscall filter, not a real micro-VM), but doesn't need nested virt.
Install gVisor via the official runsc shim and create a `runsc` RuntimeClass;
`apps/api/src/sandbox/provider.ts` only needs `KATA_RUNTIME_CLASS=runsc`.

### Variant C: split tier (API box + sandbox box)

When concurrent sandbox load is the bottleneck. Move k3s + kata onto a separate
host (or several), point the API at it by changing `KUBECONFIG` and
`KATA_CONTEXT`. No code changes needed; the API already talks to k8s over
network.

### Variant D: managed Postgres

Use Neon, Supabase, or RDS instead of self-hosted Postgres. Set `DATABASE_URL`
accordingly and skip §10 step 3. Best for ops simplicity; cheapest is still
self-hosted on the same box for small deployments.

---

## 17. Open questions / future work

- **Quota / abuse:** any signed-in user can spin up sandbox pods. Worth adding
  a rate limit on `POST /chat` per user, and a max sandbox count per user.
- **Multi-tenant secret isolation:** all users' encrypted API keys are decrypted
  by the same `BETTER_AUTH_SECRET`. If you want true per-user isolation, derive
  per-user data keys via HKDF rooted at a hardware-backed master key (KMS, age,
  vault).
- **CI/CD:** there is no GitHub Actions workflow yet. A pattern that works:
  build artifacts in CI, scp to the VPS, swap symlinks, restart units.
- **HA:** this design is single-host. For real HA you want at least: Postgres
  in async replication (or managed), the API behind two web nodes, sandbox
  pods on a separate cluster, and a load balancer with health checks. Out of
  scope for this doc.
