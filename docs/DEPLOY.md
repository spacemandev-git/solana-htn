# Deploying to Google Cloud Run

> **The production database is replicated, not synchronously committed.** The
> API runs SQLite at `/tmp/htn.db`; Litestream continuously replicates it to
> the `<project>-htn-db` Cloud Storage bucket and restores the latest replica
> whenever a container starts. The database survives deploys, crashes, cold
> starts, and plain service deletion. An unclean shutdown can still lose the
> last moment of writes.

`scripts/deploy.sh` manages the platform in the `solana-htn` GCP project:
region `northamerica-northeast2` (Toronto), a Docker Artifact Registry
repository named `htn`, and three public Cloud Run services.

| Service | Shape | Reason |
| --- | --- | --- |
| `htn-api` | 1 vCPU, 1 GiB, exactly one always-on instance, concurrency 250, 60-minute timeout, CPU always allocated | SQLite, Litestream, and the SSE hub are process-local. Litestream needs one writer; a second instance would also split live listeners. |
| `htn-pwa` | 1 vCPU, 512 MiB, zero to four instances, 5-minute timeout | Stateless adapter-node frontend. |
| `htn-sample` | 1 vCPU, 512 MiB, 0–1 instances, 1-minute timeout | the starter kit itself, serving the reference program; the smoke-test badge submits its URL |

**Never raise the API's maximum instance count** without first replacing
SQLite replication and the in-process SSE hub with shared services.

## Public hostnames

Cloud Run refuses domain mappings in Toronto, so both services sit behind one
global external HTTPS load balancer. Everything below already exists; the
deploy script never touches it.

| Hostname | Backend | Cloud Run service |
| --- | --- | --- |
| `https://solana-htn.com`, `https://www.solana-htn.com` | `htn-pwa-serverless` | `htn-pwa` |
| `https://api.solana-htn.com` | `htn-api-serverless` | `htn-api` |

Load balancer parts, all global, all in project `solana-htn`: static IP
`htn-api-ip`, serverless NEGs `htn-api-neg` and `htn-pwa-neg` (Toronto),
URL map `htn-api-urlmap` (host rule for `api.` → API, default → PWA),
managed certificates `htn-api-cert` and `htn-web-cert`, HTTPS proxy
`htn-api-https-proxy`, forwarding rule `htn-api-https-rule` on 443, and an
HTTP→HTTPS redirect (`htn-redirect-urlmap`, `htn-http-redirect-proxy`,
`htn-http-redirect-rule` on 80). DNS is the Cloud DNS zone `solana-htn-com`;
the domain itself is registered in Cloud Domains.

Backend services for serverless NEGs must be created without `--protocol` or a
port name, or the balancer answers `503 no healthy upstream`.

The blind-box relay POSTs to `https://api.solana-htn.com/api/box`.

## Prerequisites

Install the Google Cloud CLI, log in, and confirm project access:

```bash
gcloud auth login
gcloud projects describe solana-htn
```

The account needs to enable services, manage Artifact Registry, Cloud Storage,
Secret Manager, and Cloud Run, and submit Cloud Builds. Billing must be
enabled.

Defaults can be changed with `--project` / `HTN_PROJECT`, `--region` /
`HTN_REGION`, `HTN_API_URL` (default `https://api.solana-htn.com`),
`HTN_PWA_URL` (default `https://solana-htn.com`), and `HTN_SOLANA_BOX_ID`
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

## Commands

```bash
./scripts/deploy.sh up
```

Enables the APIs; creates the `htn` repository, the `htn-run` runtime service
account, and the regional `gs://<project>-htn-db` bucket if missing; grants
`htn-run` `roles/storage.objectAdmin` on that bucket only; then builds and
deploys all configured services. Idempotent.

```bash
./scripts/deploy.sh update
```

Builds and deploys without creating infrastructure. Fails with a specific
message when an API, the repository, or the bucket is missing.

```bash
./scripts/deploy.sh down [--purge]
```

Deletes all three services after confirmation. The replicated database, the
bucket, the service account, and the image repository remain unless `--purge`
is given, which also deletes the bucket contents, every image, and the service
account. The load balancer and DNS are never touched.

```bash
./scripts/deploy.sh status
./scripts/deploy.sh logs [api|pwa|sample]
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
2. Builds `deploy/Dockerfile.pwa` with `VITE_API_BASE` set to the public API
   URL (baked into the client bundle; not a runtime variable) and deploys
   `htn-pwa` with `ORIGIN` set to the public PWA URL for adapter-node CSRF
   checks.
3. When `HTN_SAMPLE_WALLET` and `HTN_SAMPLE_PROGRAM_ID` are set, builds
   `deploy/Dockerfile.sample` and deploys `htn-sample`. When they are omitted
   and the service exists, redeploys its image while preserving its existing
   wallet and program environment. When they are omitted and the service does
   not exist, skips the sample image build and deployment.

All three Dockerfiles copy every workspace `package.json` (including
`starter/`) before `bun install --frozen-lockfile`; add a new workspace to all
three files or the install fails.

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

The reward cap and RPC URL override are not set by the script; add them with
`gcloud run services update htn-api --update-env-vars ...` (see `docs/API.md`
→ Configuration) when needed.

PWA (`htn-pwa`): `NODE_ENV=production`, `ORIGIN=<public PWA URL>`.

Sample endpoint (`htn-sample`):

| Variable | Value |
| --- | --- |
| `WALLET_ADDRESS` | `HTN_SAMPLE_WALLET`, the sample endpoint's `payTo` address. |
| `PROGRAM_ID` | `HTN_SAMPLE_PROGRAM_ID`, the deployed `htn_quest` program served by the sample. |
| `SOLANA_CLUSTER` | `HTN_SOLANA_CLUSTER` (default `devnet`). |
| `PRICE_USD` | `1.00`. |
| `PORT` | Injected by Cloud Run (`8080`). |

## Resetting the live database

There is no admin endpoint. Either redeploy with `--dev-routes --yes` and call
`POST /api/dev/reset`, then redeploy without it, or stop the service, delete
`gs://<project>-htn-db/htn.db*`, and redeploy so Litestream starts empty.
