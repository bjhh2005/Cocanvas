#!/usr/bin/env bash
set -euo pipefail

# Cocanvas backend helper.
#
# This script manages the local backend dependencies defined in
# docker-compose.yml: Redis 7 and MySQL 8.
#
# Usage:
#   ./run.sh up       Start Redis and MySQL in the background.
#   ./run.sh down     Stop and remove containers, keep MySQL data.
#   ./run.sh stop     Stop containers, keep containers and MySQL data.
#   ./run.sh start    Start previously stopped containers.
#   ./run.sh restart  Restart Redis and MySQL.
#   ./run.sh ps       Show container status.
#   ./run.sh logs     Follow container logs.
#   ./run.sh clean    Stop containers and delete MySQL data volume.
#
# Notes:
#   - Use "down" for normal cleanup.
#   - Use "clean" only when you want to reset the local MySQL database.
#   - If Docker images are missing, "up" will pull redis:7 and mysql:8.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="$script_dir/$(basename "${BASH_SOURCE[0]}")"

cd "$script_dir"

command="${1:-help}"

case "$command" in
  up)
    docker compose up -d
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
  clean)
    docker compose down -v
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
