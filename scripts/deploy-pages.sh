#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PAGES_PROJECT="blackjack"
WRANGLER_VERSION="4.128.0"
PRODUCTION_BRANCH="main"
PRODUCTION_URL="https://blackjack-9bp.pages.dev/"

cd "$PROJECT_DIR"

# Local publishing may use the ignored .env.local file. CI must provide these
# variables as encrypted secrets and should not create that file on the runner.
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env.local
  set +a
fi

: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID must be set}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN must be set}"

DEPLOY_BRANCH="${1:-$PRODUCTION_BRANCH}"

echo "Building $PROJECT_DIR..."
npm run build

echo "Deploying dist/ to Cloudflare Pages project $PAGES_PROJECT (branch: $DEPLOY_BRANCH)..."
npx --yes "wrangler@${WRANGLER_VERSION}" pages deploy dist \
  --project-name "$PAGES_PROJECT" \
  --branch "$DEPLOY_BRANCH"

if [[ "$DEPLOY_BRANCH" == "$PRODUCTION_BRANCH" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to verify the production deployment." >&2
    exit 1
  fi

  echo "Verifying $PRODUCTION_URL..."
  status_code="$(curl --fail --silent --show-error --location --output /dev/null \
    --write-out '%{http_code}' "$PRODUCTION_URL")"
  if [[ "$status_code" != "200" ]]; then
    echo "Production deployment verification failed with HTTP $status_code." >&2
    exit 1
  fi

  echo "Deployed successfully: $PRODUCTION_URL"
else
  echo "Preview deployment uploaded successfully for branch: $DEPLOY_BRANCH"
fi
