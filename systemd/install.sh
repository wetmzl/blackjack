#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  exec sudo -- "$0" "$@"
fi

install -d /etc/systemd/system
install -m 0644 "$SCRIPT_DIR/blackjack.service" /etc/systemd/system/blackjack.service

systemctl daemon-reload
systemctl enable --now blackjack.service
systemctl --no-pager --full status blackjack.service
