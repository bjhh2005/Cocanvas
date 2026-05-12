#!/usr/bin/env bash
set -euo pipefail

# Cocanvas frontend helper.
#
# This script manages the frontend app with Docker.
# docker-compose.yml starts Vite dev server for React.
#
# Usage:
#   ./run.sh dev      Build and start in foreground (shows live logs, Ctrl+C to stop).
#   ./run.sh up       Build and start the frontend container in the background.
#   ./run.sh down     Stop and remove containers.
#   ./run.sh stop     Stop frontend container without removing.
#   ./run.sh start    Start previously stopped frontend container.
#   ./run.sh restart  Restart frontend container.
#   ./run.sh ps       Show container status.
#   ./run.sh logs     Follow container logs.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="$script_dir/$(basename "${BASH_SOURCE[0]}")"

cd "$script_dir"

command="${1:-help}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME-cocanvas-frontend}"
export FRONTEND_HOST_PORT="${FRONTEND_HOST_PORT-5173}"

case "$command" in
  dev)
    docker compose up --build
    ;;
  up)
    docker compose up -d --build
    ;;
  down)
    docker compose down
    ;;
  stop)
    docker compose stop
    ;;
  start)
    docker compose start
    ;;
  restart)
    docker compose restart
    ;;
  ps)
    docker compose ps
    ;;
  logs)
    docker compose logs -f
    ;;
  help|-h|--help)
    awk '
      NR == 1 { next }
      !started && /^#/ { started = 1 }
      !started { next }
      /^#/ {
        sub(/^# ?/, "")
        print
        next
      }
      { exit }
    ' "$script_path"
    ;;
  *)
    echo "Unknown command: $command" >&2
    echo "Run ./run.sh help for usage." >&2
    exit 1
    ;;
esac
