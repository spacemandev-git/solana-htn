#!/usr/bin/env bash
# Deploys, inspects, or removes the HTN Cloud Run services.
#
# Usage: ./scripts/deploy.sh <up|update|down|status|logs|url> [options]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${HTN_PROJECT:-solana-htn}"
REGION="${HTN_REGION:-northamerica-northeast2}"
REPOSITORY="htn"
API_SERVICE="htn-api"
PWA_SERVICE="htn-pwa"
SAMPLE_SERVICE="htn-sample"
# Public hostnames served by the global HTTPS load balancer (see docs/DEPLOY.md).
API_PUBLIC_URL="${HTN_API_URL:-https://api.solana-htn.com}"
PWA_PUBLIC_URL="${HTN_PWA_URL:-https://solana-htn.com}"
SOLANA_BOX_ID="${HTN_SOLANA_BOX_ID:-solana-booth}"
SOLANA_FINAL_BOX_ID="${HTN_SOLANA_FINAL_BOX_ID:-solana-booth-final}"
SOLANA_CLUSTER="${HTN_SOLANA_CLUSTER:-devnet}"
PAYER_SECRET="htn-payer-key"                      # Secret Manager secret holding X402_PAYER_SECRET_KEY
RPC_SECRET="htn-solana-rpc-url"                   # Secret Manager secret holding SOLANA_RPC_URL (keyed RPC)
SAMPLE_WALLET="${HTN_SAMPLE_WALLET:-}"            # payTo of the sample endpoint
SAMPLE_PROGRAM_ID="${HTN_SAMPLE_PROGRAM_ID:-}"    # deployed htn_quest program the sample serves
# A dedicated runtime identity so the database bucket is not readable by every
# other workload in this shared project.
RUNTIME_SA="htn-run"

COMMAND=""
TAG=""
LOG_TARGET="api"
PURGE=false
YES=false
DEV_ROUTES=false

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy.sh <command> [options]

Commands:
  up                 Enable APIs, create missing infrastructure, and deploy
  update             Deploy only; fail if required infrastructure is missing
  down [--purge]     Delete all three services; also delete durable data and infrastructure with --purge
  status             Show service URLs, latest revisions, and traffic
  logs [api|pwa|sample]
                     Tail service logs (default: api)
  url                Print the API, PWA, and optional sample URLs, one per line

Global flags:
  --project ID       GCP project (default: solana-htn; env: HTN_PROJECT)
  --region REGION    GCP region (default: northamerica-northeast2; env: HTN_REGION)
  --tag TAG          Container tag (default: short git SHA, plus -dirty)
  --yes              Bypass destructive confirmations and permit --dev-routes
  --dev-routes       Deploy the API with public development routes enabled
  --help             Show this help

Command flags:
  --purge            With down, also delete the database bucket and repository

Environment variables:
  HTN_SOLANA_FINAL_BOX_ID   Final Solana box id (default: solana-booth-final)
  HTN_SOLANA_CLUSTER        Solana cluster (default: devnet)
  HTN_SAMPLE_WALLET         Sample endpoint payTo wallet (set with program id)
  HTN_SAMPLE_PROGRAM_ID     Sample endpoint program id (set with wallet)
EOF
}

fail() {
  echo "error: $*" >&2
  exit 1
}

need_value() {
  local flag="$1"
  local value="${2:-}"
  [ -n "$value" ] || fail "$flag requires a value"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      up|update|down|status|logs|url)
        [ -z "$COMMAND" ] || fail "choose exactly one command"
        COMMAND="$1"
        ;;
      api|pwa|sample)
        [ "$COMMAND" = "logs" ] || fail "'$1' is only valid after the logs command"
        LOG_TARGET="$1"
        ;;
      --project)
        need_value "$1" "${2:-}"
        PROJECT="$2"
        shift
        ;;
      --region)
        need_value "$1" "${2:-}"
        REGION="$2"
        shift
        ;;
      --tag)
        need_value "$1" "${2:-}"
        TAG="$2"
        shift
        ;;
      --yes) YES=true ;;
      --dev-routes) DEV_ROUTES=true ;;
      --purge) PURGE=true ;;
      --help|-h)
        usage
        exit 0
        ;;
      --*) fail "unknown flag: $1 (run ./scripts/deploy.sh --help)" ;;
      *) fail "unexpected argument: $1 (run ./scripts/deploy.sh --help)" ;;
    esac
    shift
  done

  [ -n "$COMMAND" ] || fail "a command is required (run ./scripts/deploy.sh --help)"
  if { [ -n "$SAMPLE_WALLET" ] && [ -z "$SAMPLE_PROGRAM_ID" ]; } \
      || { [ -z "$SAMPLE_WALLET" ] && [ -n "$SAMPLE_PROGRAM_ID" ]; }; then
    fail "HTN_SAMPLE_WALLET and HTN_SAMPLE_PROGRAM_ID must be set together"
  fi
  if $PURGE && [ "$COMMAND" != "down" ]; then
    fail "--purge is only valid with down"
  fi
  if $DEV_ROUTES && [ "$COMMAND" != "up" ] && [ "$COMMAND" != "update" ]; then
    fail "--dev-routes is only valid with up or update"
  fi
  if $DEV_ROUTES; then
    echo "WARNING: --dev-routes makes POST /api/dev/reset publicly callable; anyone can wipe the database." >&2
    $YES || fail "--dev-routes refuses to deploy without --yes"
  fi
}

preflight() {
  command -v gcloud >/dev/null 2>&1 || fail "gcloud is not installed; install the Google Cloud SDK and retry"

  local account
  account="$(gcloud auth list --filter='status:ACTIVE' --format='value(account)' --project "$PROJECT" 2>/dev/null || true)"
  [ -n "$account" ] || fail "no active gcloud account; run 'gcloud auth login' and retry"

  local project_error
  if ! project_error="$(gcloud projects describe "$PROJECT" --project "$PROJECT" --format='value(projectId)' 2>&1)"; then
    printf '%s\n' "$project_error" >&2
    fail "GCP project '$PROJECT' is not usable; check the id and run 'gcloud config set project $PROJECT'"
  fi
}

resolve_tag() {
  [ -n "$TAG" ] && return
  TAG="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)" || fail "cannot derive an image tag; pass --tag TAG"
  if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    TAG="${TAG}-dirty"
  fi
}

ensure_repository() {
  if gcloud artifacts repositories describe "$REPOSITORY" \
      --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
    echo "Artifact Registry repository $REPOSITORY already exists"
    return
  fi

  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format docker --location "$REGION" --project "$PROJECT"
}

runtime_sa_email() {
  printf '%s@%s.iam.gserviceaccount.com\n' "$RUNTIME_SA" "$PROJECT"
}

database_bucket() {
  printf '%s-htn-db\n' "$PROJECT"
}

ensure_service_account() {
  local email
  email="$(runtime_sa_email)"

  if gcloud iam service-accounts describe "$email" --project "$PROJECT" >/dev/null 2>&1; then
    echo "Service account $email already exists"
    return
  fi

  gcloud iam service-accounts create "$RUNTIME_SA" \
    --display-name "HTN Cloud Run runtime" --project "$PROJECT"
}

ensure_bucket() {
  local bucket
  bucket="$(database_bucket)"

  if gcloud storage buckets describe "gs://$bucket" --project "$PROJECT" >/dev/null 2>&1; then
    echo "Cloud Storage bucket gs://$bucket already exists"
    return
  fi

  gcloud storage buckets create "gs://$bucket" \
    --location "$REGION" --uniform-bucket-level-access --project "$PROJECT"
}

grant_bucket_access() {
  local bucket
  local email
  bucket="$(database_bucket)"
  email="$(runtime_sa_email)"

  gcloud storage buckets add-iam-policy-binding "gs://$bucket" \
    --member "serviceAccount:$email" \
    --role roles/storage.objectAdmin \
    --project "$PROJECT" >/dev/null
  echo "Granted $email object access to gs://$bucket"
}

secret_exists() {
  gcloud secrets describe "$1" --project "$PROJECT" >/dev/null 2>&1
}

ensure_payer_secret_access() {
  local email secret
  email="$(runtime_sa_email)"
  for secret in "$PAYER_SECRET" "$RPC_SECRET"; do
    if secret_exists "$secret"; then
      gcloud secrets add-iam-policy-binding "$secret" \
        --member "serviceAccount:$email" \
        --role roles/secretmanager.secretAccessor \
        --project "$PROJECT" >/dev/null
      echo "Granted $email access to secret $secret"
    elif [ "$secret" = "$PAYER_SECRET" ]; then
      echo "Payer key: secret $PAYER_SECRET not found; payments stay disabled until it is created"
    else
      echo "RPC: secret $RPC_SECRET not found; services use the public devnet RPC"
    fi
  done
}

enable_apis() {
  gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    secretmanager.googleapis.com \
    storage.googleapis.com \
    --project "$PROJECT"
}

require_infrastructure() {
  local enabled_services
  enabled_services="$(gcloud services list --enabled --project "$PROJECT" --format='value(config.name)')"

  local service
  for service in \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    secretmanager.googleapis.com \
    storage.googleapis.com; do
    if [[ $'\n'${enabled_services}$'\n' != *$'\n'${service}$'\n'* ]]; then
      fail "required API '$service' is not enabled; run './scripts/deploy.sh up' first"
    fi
  done

  gcloud artifacts repositories describe "$REPOSITORY" \
    --location "$REGION" --project "$PROJECT" >/dev/null 2>&1 \
    || fail "Artifact Registry repository '$REPOSITORY' is missing in $REGION; run './scripts/deploy.sh up' first"
  local bucket
  bucket="$(database_bucket)"
  gcloud storage buckets describe "gs://$bucket" --project "$PROJECT" >/dev/null 2>&1 \
    || fail "Cloud Storage bucket 'gs://$bucket' is missing; run './scripts/deploy.sh up' first"
}

build_image() {
  local image="$1"
  local dockerfile="$2"
  local api_base="${3:-}"

  gcloud builds submit "$ROOT" \
    --project "$PROJECT" \
    --config "$ROOT/deploy/cloudbuild.yaml" \
    --substitutions "_IMAGE=$image,_DOCKERFILE=$dockerfile,_VITE_API_BASE=$api_base"
}

deploy_platform() {
  resolve_tag

  local registry="$REGION-docker.pkg.dev/$PROJECT/$REPOSITORY"
  local server_image="$registry/server:$TAG"
  local pwa_image="$registry/pwa:$TAG"
  local sample_image="$registry/sample:$TAG"
  local node_env="production"
  $DEV_ROUTES && node_env="development"

  echo "Building API image $server_image"
  build_image "$server_image" "deploy/Dockerfile.server"

  # On a redeploy the PWA already exists, so its origin is knowable up front.
  # --set-env-vars REPLACES the whole set, so without this the API would serve
  # one revision with no PWA_ORIGIN -- every browser call failing CORS -- until
  # the update at the end of this function lands. Carry it through instead.
  local env_vars bucket
  bucket="$(database_bucket)"
  env_vars="NODE_ENV=$node_env,DATABASE_PATH=/tmp/htn.db,LITESTREAM_BUCKET=$bucket"
  env_vars="$env_vars,PWA_ORIGIN=$PWA_PUBLIC_URL,PUBLIC_APP_URL=$PWA_PUBLIC_URL,SOLANA_BOX_ID=$SOLANA_BOX_ID"
  env_vars="$env_vars,SOLANA_FINAL_BOX_ID=$SOLANA_FINAL_BOX_ID,SOLANA_CLUSTER=$SOLANA_CLUSTER"

  # Secrets are bound by name: the payer key enables live payments, the RPC
  # URL carries a provider API key so it never lands in env vars or logs.
  local secrets="" rpc_secret_args_csv=""
  if secret_exists "$PAYER_SECRET"; then
    secrets="X402_PAYER_SECRET_KEY=$PAYER_SECRET:latest"
    echo "Payer key: secret $PAYER_SECRET (payments live)"
  else
    echo "Payer key: secret $PAYER_SECRET not found; deploying with payments disabled"
  fi
  if secret_exists "$RPC_SECRET"; then
    rpc_secret_args_csv="SOLANA_RPC_URL=$RPC_SECRET:latest"
    secrets="${secrets:+$secrets,}$rpc_secret_args_csv"
    echo "RPC: secret $RPC_SECRET"
  fi
  local -a secret_args=(--clear-secrets)
  [ -n "$secrets" ] && secret_args=(--set-secrets "$secrets")
  local -a sample_secret_args=(--clear-secrets)
  [ -n "$rpc_secret_args_csv" ] && sample_secret_args=(--set-secrets "$rpc_secret_args_csv")

  local api_url
  api_url="$(gcloud run deploy "$API_SERVICE" \
    --image "$server_image" \
    --region "$REGION" --platform managed --allow-unauthenticated \
    --min-instances=1 --max-instances=1 \
    --concurrency=250 \
    --timeout=3600 \
    --no-cpu-throttling \
    --cpu=1 --memory=1Gi \
    --set-env-vars "$env_vars" \
    "${secret_args[@]}" \
    --service-account "$(runtime_sa_email)" \
    --project "$PROJECT" \
    --format='value(status.url)')"
  [ -n "$api_url" ] || fail "the API deployed but Cloud Run returned no service URL"

  echo "Building PWA image with VITE_API_BASE=$API_PUBLIC_URL"
  build_image "$pwa_image" "deploy/Dockerfile.pwa" "$API_PUBLIC_URL"

  local pwa_url
  pwa_url="$(gcloud run deploy "$PWA_SERVICE" \
    --image "$pwa_image" \
    --region "$REGION" --platform managed --allow-unauthenticated \
    --min-instances=0 --max-instances=4 --cpu=1 --memory=512Mi --timeout=300 \
    --set-env-vars "NODE_ENV=production,ORIGIN=$PWA_PUBLIC_URL" \
    --service-account "$(runtime_sa_email)" \
    --project "$PROJECT" \
    --format='value(status.url)')"
  [ -n "$pwa_url" ] || fail "the PWA deployed but Cloud Run returned no service URL"

  local sample_url=""
  local sample_deployed=false
  if [ -n "$SAMPLE_WALLET" ] && [ -n "$SAMPLE_PROGRAM_ID" ]; then
    echo "Building sample image $sample_image"
    build_image "$sample_image" "deploy/Dockerfile.sample"
    sample_url="$(gcloud run deploy "$SAMPLE_SERVICE" \
      --image "$sample_image" \
      --region "$REGION" --platform managed --allow-unauthenticated \
      --min-instances=0 --max-instances=1 --cpu=1 --memory=512Mi --timeout=60 \
      --set-env-vars "NODE_ENV=production,WALLET_ADDRESS=$SAMPLE_WALLET,PROGRAM_ID=$SAMPLE_PROGRAM_ID,SOLANA_CLUSTER=$SOLANA_CLUSTER,PRICE_USD=1.00" \
      "${sample_secret_args[@]}" \
      --service-account "$(runtime_sa_email)" \
      --project "$PROJECT" \
      --format='value(status.url)')"
    sample_deployed=true
  elif service_exists "$SAMPLE_SERVICE"; then
    echo "htn-sample: reusing its existing WALLET_ADDRESS/PROGRAM_ID"
    echo "Building sample image $sample_image"
    build_image "$sample_image" "deploy/Dockerfile.sample"
    sample_url="$(gcloud run deploy "$SAMPLE_SERVICE" \
      --image "$sample_image" \
      --region "$REGION" --platform managed --allow-unauthenticated \
      --min-instances=0 --max-instances=1 --cpu=1 --memory=512Mi --timeout=60 \
      "${sample_secret_args[@]}" \
      --service-account "$(runtime_sa_email)" \
      --project "$PROJECT" \
      --format='value(status.url)')"
    sample_deployed=true
  else
    echo "htn-sample: skipped (set HTN_SAMPLE_WALLET and HTN_SAMPLE_PROGRAM_ID to deploy the sample endpoint)"
  fi
  if $sample_deployed; then
    [ -n "$sample_url" ] || fail "the sample deployed but Cloud Run returned no service URL"
    echo "SAMPLE: $sample_url/quest"
  fi

  echo "API: $api_url  (public: $API_PUBLIC_URL)"
  echo "PWA: $pwa_url  (public: $PWA_PUBLIC_URL)"
}

up() {
  enable_apis
  ensure_repository
  ensure_service_account
  ensure_bucket
  grant_bucket_access
  ensure_payer_secret_access
  deploy_platform
}

update() {
  require_infrastructure
  ensure_payer_secret_access
  deploy_platform
}

confirm() {
  local prompt="$1"
  local answer
  $YES && return
  printf '%s Type yes to continue: ' "$prompt" >&2
  read -r answer || fail "confirmation was not received; rerun with --yes to bypass prompts"
  [ "$answer" = "yes" ] || fail "aborted"
}

service_exists() {
  local service="$1"
  gcloud run services describe "$service" \
    --region "$REGION" --platform managed --project "$PROJECT" >/dev/null 2>&1
}

delete_service() {
  local service="$1"
  if service_exists "$service"; then
    gcloud run services delete "$service" \
      --region "$REGION" --platform managed --project "$PROJECT" --quiet
  else
    echo "Cloud Run service $service is already absent"
  fi
}

down() {
  confirm "This deletes all three Cloud Run services. The replicated database remains in Cloud Storage."
  if $PURGE; then
    confirm "PURGE also permanently deletes the database bucket and every image in '$REPOSITORY'."
  fi

  delete_service "$API_SERVICE"
  delete_service "$PWA_SERVICE"
  delete_service "$SAMPLE_SERVICE"

  if ! $PURGE; then
    return
  fi

  if gcloud artifacts repositories describe "$REPOSITORY" \
      --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud artifacts repositories delete "$REPOSITORY" \
      --location "$REGION" --project "$PROJECT" --quiet
  else
    echo "Artifact Registry repository $REPOSITORY is already absent"
  fi

  local bucket
  bucket="$(database_bucket)"
  if gcloud storage buckets describe "gs://$bucket" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud storage rm --recursive "gs://$bucket/" --project "$PROJECT" --quiet
  else
    echo "Cloud Storage bucket gs://$bucket is already absent"
  fi

  local sa_email
  sa_email="$(runtime_sa_email)"
  if gcloud iam service-accounts describe "$sa_email" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud iam service-accounts delete "$sa_email" --project "$PROJECT" --quiet
  else
    echo "Service account $sa_email is already absent"
  fi
}

status() {
  local found
  # `services list --filter` warns and exits 0 when nothing matches, which reads
  # as "everything is fine" on an empty region. Answer the question directly.
  found="$(gcloud run services list \
    --region "$REGION" --platform managed --project "$PROJECT" \
    --format='value(metadata.name)' 2>/dev/null \
    | grep -cE "^($API_SERVICE|$PWA_SERVICE|$SAMPLE_SERVICE)$" || true)"

  if [ "$found" -eq 0 ]; then
    echo "No $API_SERVICE, $PWA_SERVICE, or $SAMPLE_SERVICE in $PROJECT/$REGION; run './scripts/deploy.sh up'"
    return
  fi

  gcloud run services list \
    --region "$REGION" --platform managed --project "$PROJECT" \
    --filter="metadata.name=$API_SERVICE OR metadata.name=$PWA_SERVICE OR metadata.name=$SAMPLE_SERVICE" \
    --format='table(metadata.name:label=SERVICE,status.url:label=URL,status.latestReadyRevisionName:label=LATEST_REVISION,status.traffic[].revisionName.flatten():label=TRAFFIC_REVISION,status.traffic[].percent.flatten():label=TRAFFIC_PERCENT)'
}

logs() {
  local service="$API_SERVICE"
  [ "$LOG_TARGET" = "pwa" ] && service="$PWA_SERVICE"
  [ "$LOG_TARGET" = "sample" ] && service="$SAMPLE_SERVICE"
  gcloud run services logs tail "$service" \
    --region "$REGION" --project "$PROJECT"
}

service_url() {
  local service="$1"
  local result
  result="$(gcloud run services describe "$service" \
    --region "$REGION" --platform managed --project "$PROJECT" \
    --format='value(status.url)' 2>/dev/null)" \
    || fail "Cloud Run service '$service' is missing; run './scripts/deploy.sh up' first"
  [ -n "$result" ] || fail "Cloud Run service '$service' has no URL"
  printf '%s\n' "$result"
}

urls() {
  local api_url
  local pwa_url
  api_url="$(service_url "$API_SERVICE")"
  pwa_url="$(service_url "$PWA_SERVICE")"
  printf '%s\n%s\n' "$api_url" "$pwa_url"
  if service_exists "$SAMPLE_SERVICE"; then
    printf '%s/quest\n' "$(service_url "$SAMPLE_SERVICE")"
  fi
}

parse_args "$@"
preflight

case "$COMMAND" in
  up) up ;;
  update) update ;;
  down) down ;;
  status) status ;;
  logs) logs ;;
  url) urls ;;
esac
