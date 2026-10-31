#!/usr/bin/env bash
# Removes the eCards API service and files. Keeps the database unless --drop-database is given.
#   bash uninstall.sh                  # stop and remove service, user and /opt/ecards (keeps a .env backup and the database)
#   bash uninstall.sh --drop-database  # also deletes the database and role THIS install created (read from its .env)
set -euo pipefail
[[ $EUID -eq 0 ]] && SUDO="" || SUDO="sudo"
AS() { local u=$1; shift; if [[ $EUID -eq 0 ]]; then runuser -u "$u" -- "$@"; else sudo -u "$u" "$@"; fi; }
read -r -p "Remove the eCards API from this server? [y/N] " a; [[ "$a" =~ ^[Yy]$ ]] || exit 1

# the database this install uses, from its own settings: never a guessed name
DB_NAME=""; DB_USER=""; DB_PORT=5432; PORT=10011
if [[ -f /opt/ecards/.env ]]; then
  URL=$($SUDO grep '^DATABASE_URL=' /opt/ecards/.env | cut -d= -f2-)
  DB_USER=$(sed -E 's#^postgres://([^:]+):.*#\1#' <<<"$URL")
  DB_PORT=$(sed -E 's#.*@[^:/]+:([0-9]+)/.*#\1#' <<<"$URL")
  DB_NAME=$(sed -E 's#.*/([^/?]+)(\?.*)?$#\1#' <<<"$URL")
  PORT=$($SUDO grep '^PORT=' /opt/ecards/.env | cut -d= -f2)
fi

$SUDO systemctl disable --now ecards-api 2>/dev/null || true
$SUDO rm -f /etc/systemd/system/ecards-api.service && $SUDO systemctl daemon-reload
if [[ -f /opt/ecards/.env ]]; then
  B=~/ecards-env-backup-$(date +%Y%m%d-%H%M%S); $SUDO cp /opt/ecards/.env "$B"; $SUDO chown "$(id -u)" "$B"; chmod 600 "$B"
  echo "kept a copy of the settings and keys in $B"
fi
$SUDO rm -rf /opt/ecards
if id ecards >/dev/null 2>&1; then
  $SUDO pkill -u ecards 2>/dev/null || true; sleep 1   # anything left running as the app user
  $SUDO userdel ecards || echo "could not remove user ecards (remove it later with: sudo userdel ecards)"
fi

if [[ "${1:-}" == "--drop-database" ]]; then
  if [[ -z "$DB_NAME" || -z "$DB_USER" ]]; then
    echo "settings file not found: not dropping any database. Drop it by hand if needed."
  else
    AS postgres psql -p "$DB_PORT" -qc "DROP DATABASE IF EXISTS \"$DB_NAME\"" -c "DROP ROLE IF EXISTS \"$DB_USER\""
    echo "dropped database $DB_NAME and role $DB_USER"
  fi
fi
if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "$PORT/tcp"; then
  $SUDO ufw delete allow "$PORT/tcp" >/dev/null && echo "ufw rule for $PORT removed"
fi
echo "eCards API removed."
