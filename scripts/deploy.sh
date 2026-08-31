#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="blackjack.service"

cd "$PROJECT_DIR"
export PATH="/home/magallan/.local/bin:/usr/local/bin:/usr/bin:/bin${PATH:+:$PATH}"

echo "Building $PROJECT_DIR..."
npm run build

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  SYSTEMCTL=(systemctl)
else
  SYSTEMCTL=(sudo systemctl)
fi

echo "Reloading systemd and restarting $SERVICE_NAME..."
"${SYSTEMCTL[@]}" daemon-reload
"${SYSTEMCTL[@]}" restart "$SERVICE_NAME"
"${SYSTEMCTL[@]}" is-active --quiet "$SERVICE_NAME"

if command -v curl >/dev/null 2>&1; then
  ready=false
  for attempt in {1..20}; do
    if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:4173/ >/dev/null; then
      ready=true
      break
    fi
    sleep 0.5
  done
  if [[ "$ready" != true ]]; then
    echo "Service did not become ready at http://127.0.0.1:4173/" >&2
    "${SYSTEMCTL[@]}" --no-pager --full status "$SERVICE_NAME" >&2 || true
    exit 1
  fi
fi

echo "Deployed successfully: http://127.0.0.1:4173/"
