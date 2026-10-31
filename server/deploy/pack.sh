#!/usr/bin/env bash
# Builds the deployable tarball: compiled code, migrations, lockfile and deploy scripts (no source, no secrets).
#   bash deploy/pack.sh   →  release/ecards-server.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist && npm run build >/dev/null
mkdir -p release
tar -czf release/ecards-server.tar.gz dist migrations package.json package-lock.json deploy README.md .env.example
echo "release/ecards-server.tar.gz ($(du -h release/ecards-server.tar.gz | cut -f1))"
