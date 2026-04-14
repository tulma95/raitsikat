#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

IMAGE="${IMAGE:-raitsikat}"
CONTAINER="${CONTAINER:-raitsikat}"
PORT="${PORT:-3000}"

docker build -t "$IMAGE" .

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
exec docker run --rm --name "$CONTAINER" -p "${PORT}:3000" "$IMAGE"
