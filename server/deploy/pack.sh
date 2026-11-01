#!/usr/bin/env bash
# Builds the deployable tarball: compiled code, migrations, lockfile and deploy scripts (no source, no secrets).
#   bash deploy/pack.sh   →  release/ecards-server.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -d node_modules ]] || npm ci --no-audit --no-fund --loglevel=error   # build tools, only inside this folder
rm -rf dist && npm run build >/dev/null
mkdir -p release
# the front end (mini app, admin panel, web store, images) is served by the API from public/
rm -rf release/public && mkdir -p release/public
cp ../index.html ../admin.html ../web.html release/public/ && cp -r ../assets release/public/
tar -czf release/ecards-server.tar.gz dist migrations package.json package-lock.json deploy README.md .env.example -C release public
rm -rf release/public
echo "release/ecards-server.tar.gz ($(du -h release/ecards-server.tar.gz | cut -f1))"
