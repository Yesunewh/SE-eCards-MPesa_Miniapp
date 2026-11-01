#!/usr/bin/env bash
# eCards API: install or update on a shared Linux VPS, without disturbing what already runs there.
#
#   bash install.sh ecards-server.tar.gz          # install or update (asks before changing anything)
#   bash install.sh ecards-server.tar.gz --check  # preflight only: changes nothing
#
# What it does, and what it never does:
#   + its own system user `ecards`, everything under /opt/ecards, its own Node.js copy in /opt/ecards/node
#   + its own database and role inside PostgreSQL (reuses a running PostgreSQL; installs one only if there is none)
#   + one systemd service `ecards-api` on port 10011, capped at 512 MB RAM and half a CPU, low priority
#   + opens port 10011 in ufw/firewalld only if one of them is active (adds a rule, removes nothing)
#   - never restarts, reconfigures or upgrades existing services, never touches other databases,
#     never runs apt upgrade, never changes the system Node.js, never edits iptables by hand
set -euo pipefail

PORT="${ECARDS_PORT:-10011}"
BASE=/opt/ecards
APP_USER=ecards
DB_NAME="${ECARDS_DB_NAME:-ecards}"
DB_USER="${ECARDS_DB_USER:-ecards}"
SERVICE=ecards-api
NODE_MAJOR=22

TARBALL="${1:-}"
CHECK_ONLY=false; [[ "${2:-}" == "--check" || "${1:-}" == "--check" ]] && CHECK_ONLY=true

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '   ok    %s\n' "$*"; }
warn() { printf '   WARN  %s\n' "$*"; }
die()  { printf '\n   STOP  %s\n\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] && SUDO="" || SUDO="sudo"
# run a command as another user, whether we are root or a sudoer
AS() { local u=$1; shift; if [[ $EUID -eq 0 ]]; then runuser -u "$u" -- "$@"; else sudo -u "$u" "$@"; fi; }
FIRST_INSTALL=true; [[ -f $BASE/.env ]] && FIRST_INSTALL=false

# ---------------------------------------------------------------- preflight (read-only)
say "Preflight checks (nothing is changed yet)"
. /etc/os-release 2>/dev/null || true
ok "OS: ${PRETTY_NAME:-unknown} ($(uname -m))"
case "$(uname -m)" in x86_64) NODE_ARCH=x64 ;; aarch64) NODE_ARCH=arm64 ;; *) die "unsupported CPU $(uname -m)";; esac
command -v systemctl >/dev/null || die "systemd is required"

MEM_AVAIL_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
DISK_FREE_MB=$(df -Pm /opt 2>/dev/null | awk 'NR==2 {print $4}')
ok "free memory: ${MEM_AVAIL_MB} MB · free disk on /opt: ${DISK_FREE_MB} MB · load: $(cut -d' ' -f1-3 /proc/loadavg)"
(( MEM_AVAIL_MB >= 400 )) || die "less than 400 MB of memory available: not installing next to the call center"
(( DISK_FREE_MB >= 1500 )) || die "less than 1.5 GB free disk on /opt"

# is something listening on a TCP port? (ss when available, else a direct connection attempt)
port_used() {
  if command -v ss >/dev/null; then $SUDO ss -ltnH "( sport = :$1 )" | grep -q .
  else (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null; fi
}
if port_used "$PORT"; then
  if systemctl is-active --quiet $SERVICE 2>/dev/null; then
    ok "port $PORT is used by $SERVICE (this is an update)"
  else
    command -v ss >/dev/null && $SUDO ss -ltnpH "( sport = :$PORT )"
    die "port $PORT is already used by another program. Re-run with ECARDS_PORT=<free port>."
  fi
else
  ok "port $PORT is free"
fi

PG_RUNNING=false; PG_PORT=5432
if command -v pg_lsclusters >/dev/null && pg_lsclusters -h 2>/dev/null | awk '$4=="online"' | grep -q .; then
  PG_RUNNING=true
  PG_PORT=$(pg_lsclusters -h | awk '$4=="online" {print $3; exit}')
  ok "PostgreSQL $(pg_lsclusters -h | awk '$4=="online" {print $1; exit}') is running on port $PG_PORT: will add one database to it, nothing else"
elif systemctl is-active --quiet postgresql 2>/dev/null; then
  PG_RUNNING=true; ok "PostgreSQL service is running: will add one database to it"
else
  if port_used 5432; then die "something other than a managed PostgreSQL listens on 5432; install PostgreSQL manually"; fi
  [[ "${ID:-}${ID_LIKE:-}" =~ (debian|ubuntu) ]] || die "no PostgreSQL found and this is not Debian/Ubuntu: install PostgreSQL 14+ first, then re-run"
  warn "no PostgreSQL running: will install the distribution's postgresql package (listens on localhost only)"
fi

FW=none
if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then FW=ufw
elif systemctl is-active --quiet firewalld 2>/dev/null; then FW=firewalld; fi
ok "firewall: $FW$([[ $FW == none ]] && echo ' (if your provider has a cloud firewall, open port '$PORT' there)')"
command -v docker >/dev/null && ok "docker present: not used, left alone"
command -v node >/dev/null && ok "system node $(node -v): not used, left alone"

say "Services running now (for your reference; none of them will be touched)"
systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print "   " $1}' | head -40

if $CHECK_ONLY; then say "Preflight done (--check): nothing was changed."; exit 0; fi
[[ -n "$TARBALL" && -f "$TARBALL" ]] || die "usage: bash install.sh ecards-server.tar.gz"
if [[ -t 0 ]]; then
  read -r -p $'\nProceed with the install? [y/N] ' a; [[ "$a" =~ ^[Yy]$ ]] || die "cancelled, nothing changed"
fi

# ---------------------------------------------------------------- user, folders, Node.js
say "App user and Node.js"
id $APP_USER >/dev/null 2>&1 || $SUDO useradd --system --home $BASE --shell /usr/sbin/nologin $APP_USER
$SUDO mkdir -p $BASE/releases
$SUDO chown root:root $BASE && $SUDO chmod 755 $BASE

if [[ ! -x $BASE/node/bin/node ]]; then
  TMP=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE=$(grep -oE "node-v[0-9.]+-linux-${NODE_ARCH}\.tar\.xz" "$TMP/SHASUMS256.txt" | head -1)
  curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | sha256sum -c -) || die "Node.js download failed its checksum"
  $SUDO mkdir -p $BASE/node && $SUDO tar -xJf "$TMP/$FILE" -C $BASE/node --strip-components=1
  rm -rf "$TMP"
fi
NODE=$BASE/node/bin/node; NPM=$BASE/node/bin/npm
ok "Node.js $($NODE -v) in $BASE/node (private copy)"

# ---------------------------------------------------------------- PostgreSQL
say "Database"
if ! $PG_RUNNING; then
  $SUDO apt-get update -qq
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-upgrade postgresql
  PG_PORT=$(pg_lsclusters -h | awk '$4=="online" {print $3; exit}'); PG_PORT=${PG_PORT:-5432}
fi
rand() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
hex()  { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

if $FIRST_INSTALL; then DB_PASS=$(hex 24); else DB_PASS=$($SUDO grep '^DATABASE_URL=' $BASE/.env | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#'); fi
psqlq() { AS postgres psql -p "$PG_PORT" -v ON_ERROR_STOP=1 -qtAX "$@"; }
ROLE_EXISTS=$(psqlq -c "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")
DB_EXISTS=$(psqlq -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")
if $FIRST_INSTALL && [[ -n "$ROLE_EXISTS$DB_EXISTS" ]]; then
  # never take over a database or role that some other application might own
  die "PostgreSQL already has a role or database called '$DB_USER'/'$DB_NAME'. Re-run with ECARDS_DB_NAME=… ECARDS_DB_USER=… set to unused names."
fi
[[ -n "$ROLE_EXISTS" ]] || psqlq -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
[[ -n "$DB_EXISTS" ]] || psqlq -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
ok "database $DB_NAME (role $DB_USER) on localhost:$PG_PORT"

# ---------------------------------------------------------------- configuration (kept across updates)
if $FIRST_INSTALL; then
  say "Configuration"
  PUBLIC_IP=$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  $SUDO tee $BASE/.env >/dev/null <<EOF
# eCards API configuration. Keep this file private, and back it up: without CODE_ENCRYPTION_KEY
# the gift card codes in the database cannot be read.
NODE_ENV=production
HOST=0.0.0.0
PORT=$PORT
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:$PG_PORT/$DB_NAME
CORS_ORIGINS=https://ecard-miniapp.paperless.et
CODE_ENCRYPTION_KEY=$(rand 32)
CODE_HMAC_KEY=$(rand 32)
RUN_WORKER=true
PUBLIC_BASE_URL=http://$PUBLIC_IP:$PORT
MPESA_CALLBACK_SECRET=$(hex 24)

# Staging: mock M-Pesa and mock provider (no real money, DEMO codes) until the real APIs are connected.
# Do NOT upload real gift card codes while PAYMENTS_ADAPTER=mock.
ALLOW_MOCK_ADAPTERS=true
PAYMENTS_ADAPTER=mock
GIFTCARD_ADAPTER=mock
DEV_SIMULATE_KEY=$(hex 16)
EOF
  ok "wrote $BASE/.env (new keys generated)"
fi
# serve the mini app and admin panel from this server (added to older installs too)
$SUDO grep -q '^STATIC_DIR=' $BASE/.env || echo "STATIC_DIR=$BASE/current/public" | $SUDO tee -a $BASE/.env >/dev/null
$SUDO chown root:$APP_USER $BASE/.env && $SUDO chmod 640 $BASE/.env

# ---------------------------------------------------------------- application release
say "Application"
REL=$BASE/releases/$(date +%Y%m%d-%H%M%S)
$SUDO mkdir -p "$REL"
$SUDO tar -xzf "$TARBALL" -C "$REL"
$SUDO chown -R $APP_USER:$APP_USER "$REL"
AS $APP_USER env PATH="$BASE/node/bin:$PATH" HOME="$REL" npm_config_cache="$REL/.npm" \
  bash -c "cd '$REL' && $NPM ci --omit=dev --no-audit --no-fund --update-notifier=false --loglevel=error" >/dev/null
ok "dependencies installed in $REL"

runapp() { AS $APP_USER bash -c "set -a; . $BASE/.env; set +a; cd '$REL' && $NODE $*"; }
runapp dist/db/migrate.js
if $FIRST_INSTALL; then runapp dist/db/seed.js --mock-provider --demo-stock; else runapp dist/db/seed.js; fi

PREV=""; [[ -L $BASE/current ]] && PREV=$(readlink -f $BASE/current)
$SUDO ln -sfn "$REL" $BASE/current

# ---------------------------------------------------------------- service
say "Service"
$SUDO install -m 644 "$REL/deploy/ecards-api.service" /etc/systemd/system/$SERVICE.service
$SUDO systemctl daemon-reload
$SUDO systemctl enable --quiet $SERVICE
$SUDO systemctl restart $SERVICE

healthy=false
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then healthy=true; break; fi
  sleep 1
done
if ! $healthy; then
  $SUDO journalctl -u $SERVICE -n 40 --no-pager || true
  if [[ -n "$PREV" && "$PREV" != "$REL" ]]; then
    warn "new version did not start: rolling back to $PREV"
    $SUDO ln -sfn "$PREV" $BASE/current && $SUDO systemctl restart $SERVICE
  fi
  die "the API did not answer on port $PORT (log above)"
fi
ok "ecards-api is running: $(curl -fsS http://127.0.0.1:$PORT/health)"

# keep the 3 newest releases
ls -1dt $BASE/releases/*/ | tail -n +4 | xargs -r $SUDO rm -rf

case $FW in
  ufw)       $SUDO ufw allow "$PORT/tcp" comment 'ecards-api' >/dev/null && ok "ufw: allowed $PORT/tcp" ;;
  firewalld) $SUDO firewall-cmd -q --permanent --add-port="$PORT/tcp" && $SUDO firewall-cmd -q --reload && ok "firewalld: opened $PORT/tcp" ;;
esac

# ---------------------------------------------------------------- first admin
if $FIRST_INSTALL && [[ -t 0 ]]; then
  say "Create the first admin (for the admin API)"
  read -r -p "   admin email: " AEMAIL
  read -r -p "   full name:   " ANAME
  read -r -s -p "   password (10+ characters): " APASS; echo
  AS $APP_USER bash -c "set -a; . $BASE/.env; set +a; cd '$REL' && ADMIN_PASSWORD=\"\$0\" $NODE dist/scripts/create-admin.js \"\$1\" \"\$2\" owner" "$APASS" "$AEMAIL" "$ANAME" || warn "admin not created; run it later (see README)"
fi

say "Done"
echo "   Mini app:   http://$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || echo '<server-ip>'):$PORT/      Admin: /admin.html"
echo "   API:        http://$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || echo '<server-ip>'):$PORT/health"
echo "   Catalog:    /v1/catalog      Admin: /v1/admin/login"
echo "   Logs:       sudo journalctl -u $SERVICE -f"
echo "   Settings:   $BASE/.env (back it up somewhere safe)"
echo "   Dev key for /v1/dev/mpesa/simulate: sudo grep DEV_SIMULATE_KEY $BASE/.env"
