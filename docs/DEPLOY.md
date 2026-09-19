# Deploying to Google Cloud Run

> **The production databases are replicated, not synchronously committed.**
> The API and badge service run SQLite at `/tmp/htn.db` and `/tmp/badge.db`;
> Litestream continuously replicates both to distinct object paths in the
> `<project>-htn-db` Cloud Storage bucket and restores the latest replica when
> a container starts. The databases survive deploys, crashes, cold starts, and
> plain service deletion. An unclean shutdown can still lose the last moment
> of writes.

`scripts/deploy.sh` manages the platform in the `solana-htn` GCP project:
region `northamerica-northeast2` (Toronto), a Docker Artifact Registry
repository named `htn`, and four public Cloud Run services.

| Service | Shape | Reason |
| --- | --- | --- |
| `htn-api` | 2 vCPU, 1 GiB, exactly one always-on instance, concurrency 1000, 60-minute timeout, CPU always allocated | SQLite, Litestream, and the SSE hub are process-local. Litestream needs one writer; a second instance would also split live listeners. |
| `htn-pwa` | 1 vCPU, 512 MiB, zero to four instances, 5-minute timeout | Stateless adapter-node frontend. |
| `htn-badge` | 1 vCPU, 512 MiB, exactly one always-on instance, concurrency 1000, 60-minute timeout, CPU always allocated | Badge WebSockets and reply correlation are process-local, and Litestream needs one writer. |
| `htn-sample` | 1 vCPU, 512 MiB, 0–1 instances, 1-minute timeout | the starter kit itself, serving the reference program; the smoke-test badge submits its URL |

**Never raise the API's or badge service's maximum instance count** without
first replacing their SQLite replication and in-process SSE, WebSocket, and
reply-correlation state with shared services.

## Public hostnames

Cloud Run refuses domain mappings in Toronto, so the public services sit behind
one global external HTTPS load balancer. The API and PWA resources already
exist. `deploy.sh up` creates the badge-specific load-balancer and DNS resources
below when missing; `update` never changes them and warns when the badge backend
has not been wired.

| Hostname | Backend | Cloud Run service |
| --- | --- | --- |
| `https://solana-htn.com`, `https://www.solana-htn.com` | `htn-pwa-serverless` | `htn-pwa` |
| `https://api.solana-htn.com` | `htn-api-serverless` | `htn-api` |
| `https://badge.solana-htn.com` | `htn-badge-serverless` | `htn-badge` |

Load balancer parts, all global, all in project `solana-htn`: static IP
`htn-api-ip`, serverless NEGs `htn-api-neg`, `htn-pwa-neg`, and
`htn-badge-neg` (Toronto), backend `htn-badge-serverless` (serverless NEG
backends take no timeout; Cloud Run's 3600 s request timeout bounds each badge
WebSocket), URL map `htn-api-urlmap` (host rule for `api.` → API, `htn-badge`
path matcher for `badge.` → badge, default → PWA), managed certificates
`htn-api-cert`, `htn-web-cert`, and `htn-badge-cert`, HTTPS proxy
`htn-api-https-proxy`, forwarding rule `htn-api-https-rule` on 443, and an
HTTP→HTTPS redirect (`htn-redirect-urlmap`, `htn-http-redirect-proxy`,
`htn-http-redirect-rule` on 80). DNS is the Cloud DNS zone `solana-htn-com`;
its `badge.solana-htn.com` A record points at `htn-api-ip`, and the domain
itself is registered in Cloud Domains. Badge resource creation is idempotent:
each existing NEG, backend attachment, certificate, proxy certificate binding,
URL-map host rule, and DNS record is left in place.

Backend services for serverless NEGs must be created without `--protocol` or a
port name, or the balancer answers `503 no healthy upstream`.

The blind-box relay POSTs to `https://api.solana-htn.com/api/box`.

### The frontend serves absolute asset URLs

`apps/pwa/svelte.config.js` pins `kit.paths.assets` to
`https://solana-htn.com`, so the built HTML references every hashed script,
stylesheet, and `static/` file at the apex rather than root-relative. A visitor
who lands on `www.solana-htn.com` therefore fetches its JavaScript modules
cross-origin, which needs the apex to answer those requests with
`Access-Control-Allow-Origin`. Both hostnames hit the same `htn-pwa-serverless`
backend, so this is a response-header concern on the load balancer, not a
routing one — if the console renders blank HTML on `www.` with CORS errors in
the console, that header is missing.

`kit.paths.assets` and a service worker are mutually exclusive in SvelteKit, so
there is no longer an offline app shell: the console still installs to the home
screen from `manifest.webmanifest`, but it needs network on every load. A
self-destructing worker is parked at `apps/pwa/static/service-worker.js` so
phones that installed an earlier build unregister and drop their stale caches
on the next update check; it can be deleted once the event is over. Re-adding
`apps/pwa/src/service-worker.ts` will fail the build with "Cannot use service
worker alongside config.kit.paths.assets".

## Prerequisites

Install the Google Cloud CLI, log in, and confirm project access:

```bash
gcloud auth login
gcloud projects describe solana-htn
```

The account needs to enable services, manage Artifact Registry, Cloud Storage,
Secret Manager, Cloud Run, the global load balancer, and Cloud DNS, and submit
Cloud Builds. Billing must be enabled.

Defaults can be changed with `--project` / `HTN_PROJECT`, `--region` /
`HTN_REGION`, `HTN_API_URL` (default `https://api.solana-htn.com`),
`HTN_PWA_URL` (default `https://solana-htn.com`), `HTN_BADGE_URL` (default
`https://badge.solana-htn.com`), and `HTN_SOLANA_BOX_ID`
(default `solana-booth`), `HTN_SOLANA_FINAL_BOX_ID` (default
`solana-booth-final`), `HTN_SOLANA_CLUSTER` (default `devnet`), and the paired
`HTN_SAMPLE_WALLET` / `HTN_SAMPLE_PROGRAM_ID` values used to configure the
sample endpoint. Images are tagged with the short Git SHA plus
`-dirty` when the worktree is dirty; `--tag` overrides it.

### Payer key

Create the Secret Manager secret once with the base58-encoded 64-byte payer
key:

```bash
printf '%s' "<base58 64-byte key>" | gcloud secrets create htn-payer-key --data-file=- --project solana-htn
```

Rotate it by adding a new version:

```bash
printf '%s' "<base58 64-byte key>" | gcloud secrets versions add htn-payer-key --data-file=- --project solana-htn
```

Both `up` and `update` grant `htn-run` secret accessor permission when the
secret exists and bind its latest version to the API as
`X402_PAYER_SECRET_KEY`. If the secret is absent, deployment continues with
payments disabled.

### RPC URL

The RPC endpoint carries a provider API key (Helius devnet), so it is also a
secret, `htn-solana-rpc-url`, bound as `SOLANA_RPC_URL` on both `htn-api` and
`htn-sample`:

```bash
printf '%s' "https://devnet.helius-rpc.com/?api-key=<key>" | gcloud secrets create htn-solana-rpc-url --data-file=- --project solana-htn
```

When the secret is absent the services fall back to the public cluster RPC.
Never put the keyed URL in `--set-env-vars`, docs, or commit messages.

### Badge admin token

The optional `htn-badge-admin-token` secret enables authenticated app deletion
through the badge service. Create it once with a long random token:

```bash
printf '%s' "<random admin token>" | gcloud secrets create htn-badge-admin-token --data-file=- --project solana-htn
```

Rotate it by adding a version:

```bash
printf '%s' "<new random admin token>" | gcloud secrets versions add htn-badge-admin-token --data-file=- --project solana-htn
```

Both `up` and `update` grant `htn-run` secret accessor permission when the
secret exists and bind its latest version to `htn-badge` as `ADMIN_TOKEN`. If
it is absent, deployment continues and badge app deletion remains disabled.

## Commands

```bash
./scripts/deploy.sh up
```

Enables the APIs; creates the `htn` repository, the `htn-run` runtime service
account, and the regional `gs://<project>-htn-db` bucket if missing; grants
`htn-run` `roles/storage.objectAdmin` on that bucket only; then builds and
deploys all configured services. It also creates every missing badge-specific
load-balancer and DNS resource idempotently.

```bash
./scripts/deploy.sh wire
```

Runs only the badge hostname step from `up`: creates whichever of the badge
NEG, backend service, certificate, proxy binding, URL-map host rule, and DNS
record are missing. Use it after fixing a partial `up`.

```bash
./scripts/deploy.sh update
```

Builds and deploys without creating infrastructure. Fails with a specific
message when an API, the repository, or the bucket is missing. It warns, but
does not fail or modify the load balancer, when `htn-badge-serverless` is
missing; run `up` to wire the badge hostname.

```bash
./scripts/deploy.sh down [--purge]
```

Deletes all four services after confirmation. The replicated databases, the
bucket, the service account, and the image repository remain unless `--purge`
is given, which also deletes the bucket contents, every image, and the service
account. The load balancer and DNS are never touched, even with `--purge`.

```bash
./scripts/deploy.sh status
./scripts/deploy.sh logs [api|pwa|badge|sample]
./scripts/deploy.sh url
```

| Flag | Effect |
| --- | --- |
| `--yes` | Bypass `down` confirmations or explicitly accept the development-route risk. |
| `--dev-routes` | Set the API's `NODE_ENV` to `development`. Requires `--yes`. This publicly exposes `POST /api/dev/reset`, which wipes the database. |

## What a deploy does

1. Builds `deploy/Dockerfile.server` with Cloud Build and deploys `htn-api`
   with `PWA_ORIGIN` and `PUBLIC_APP_URL` set to the public PWA URL, so pairing
   links returned to badges point at `https://solana-htn.com/s/<code>`.
2. Builds `deploy/Dockerfile.badge` and deploys `htn-badge`, restoring and
   replicating `/tmp/badge.db` through the shared bucket's `badge.db` object
   path. It binds the optional admin secret when present.
3. Builds `deploy/Dockerfile.pwa` with `VITE_API_BASE` and
   `VITE_BADGE_API_BASE` set to the public API and badge URLs. Both are baked
   into the client bundle, not runtime variables. It deploys `htn-pwa` with
   `ORIGIN` set to the public PWA URL for adapter-node CSRF checks.
4. When `HTN_SAMPLE_WALLET` and `HTN_SAMPLE_PROGRAM_ID` are set, builds
   `deploy/Dockerfile.sample` and deploys `htn-sample`. When they are omitted
   and the service exists, redeploys its image while preserving its existing
   wallet and program environment. When they are omitted and the service does
   not exist, skips the sample image build and deployment.

All four Dockerfiles copy every workspace `package.json` (including `starter/`)
before `bun install --frozen-lockfile`; add a new workspace to all four files
or the install fails.

## Runtime environment

API (`htn-api`):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (or `development` with `--dev-routes`). |
| `DATABASE_PATH` | `/tmp/htn.db`, restored by Litestream on boot. |
| `LITESTREAM_BUCKET` | `<project>-htn-db`. |
| `PWA_ORIGIN`, `PUBLIC_APP_URL` | The public PWA URL. |
| `SOLANA_BOX_ID` | The `box` id of the Solana station. |
| `SOLANA_FINAL_BOX_ID` | The final `box` id of the Solana station. |
| `SOLANA_CLUSTER` | The selected Solana cluster (default `devnet`). |
| `X402_PAYER_SECRET_KEY` | Latest version of the `htn-payer-key` Secret Manager secret, when present. |
| `SOLANA_RPC_URL` | Latest version of the `htn-solana-rpc-url` secret, when present. |

The reward cap is not set by the script; add it with
`gcloud run services update htn-api --update-env-vars ...` (see `docs/API.md`
→ Configuration) when needed.

PWA (`htn-pwa`): `NODE_ENV=production`, `ORIGIN=<public PWA URL>`.

Badge service (`htn-badge`):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (or `development` with `--dev-routes`). |
| `DATABASE_PATH` | `/tmp/badge.db`, restored by Litestream on boot. |
| `LITESTREAM_BUCKET` | `<project>-htn-db`; the replica object path is `badge.db`. |
| `CORS_ORIGINS` | The public PWA URL plus its `www.` variant, so the console passes CORS from both hostnames. |
| `PUBLIC_URL` | The public badge URL (default `https://badge.solana-htn.com`). |
| `ADMIN_TOKEN` | Latest version of `htn-badge-admin-token`, when present. |

Sample endpoint (`htn-sample`):

| Variable | Value |
| --- | --- |
| `WALLET_ADDRESS` | `HTN_SAMPLE_WALLET`, the sample endpoint's `payTo` address. |
| `PROGRAM_ID` | `HTN_SAMPLE_PROGRAM_ID`, the deployed `htn_quest` program served by the sample. |
| `SOLANA_CLUSTER` | `HTN_SOLANA_CLUSTER` (default `devnet`). |
| `PRICE_USD` | `1.00`. |
| `SOLANA_RPC_URL` | Latest version of the `htn-solana-rpc-url` secret, when present. |
| `PORT` | Injected by Cloud Run (`8080`). |

## Resetting the live database

For the API database, either redeploy with `--dev-routes --yes` and call
`POST /api/dev/reset`, then redeploy without it, or stop `htn-api`, delete
`gs://<project>-htn-db/htn.db*`, and redeploy. To reset the badge database,
stop `htn-badge`, delete `gs://<project>-htn-db/badge.db*`, and redeploy. Stop
the corresponding service before deleting either prefix so Litestream cannot
replicate the old database back into the bucket.
