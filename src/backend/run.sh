#!/usr/bin/env bash
set -euo pipefail

# Cocanvas backend helper.
#
# This script manages the backend app and its local dependencies with Docker.
# docker-compose.yml starts Spring Boot, Redis 7, and MySQL 8.
#
# Usage:
#   ./run.sh dev      Build and start Spring Boot, Redis, and MySQL in foreground (shows live logs).
#   ./run.sh up       Build and start Spring Boot, Redis, and MySQL.
#   ./run.sh app      Build and start only Spring Boot with dependencies.
#   ./run.sh deps     Start only Redis and MySQL in the background.
#   ./run.sh test     Run backend tests inside Docker.
#   ./run.sh config   Show resolved Docker Compose config.
#   ./run.sh env      Show current backend environment values.
#   ./run.sh down     Stop and remove containers, keep MySQL data.
#   ./run.sh down-all Stop current and legacy Cocanvas backend containers.
#   ./run.sh stop     Stop containers, keep containers and MySQL data.
#   ./run.sh start    Start previously stopped containers.
#   ./run.sh restart  Restart all backend containers.
#   ./run.sh ps       Show container status.
#   ./run.sh logs     Follow container logs.
#   ./run.sh clean    Stop containers and delete MySQL data volume.
#
# Notes:
#   - Use "down" for normal cleanup.
#   - Use "clean" only when you want to reset the local MySQL database.
#   - No local Java or Gradle install is required for normal startup.
#   - The Java project is isolated under ./java.
#   - MySQL maps to host port 3307 by default to avoid local MySQL conflicts.
#     Override with MYSQL_HOST_PORT=3306 ./run.sh up when port 3306 is free.
#   - Copy .env.example to .env for per-developer ports and project names.

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

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME-cocanvas}"
export BACKEND_HOST_PORT="${BACKEND_HOST_PORT-8080}"
export REDIS_HOST_PORT="${REDIS_HOST_PORT-6379}"
export MYSQL_HOST_PORT="${MYSQL_HOST_PORT-3307}"
export MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD-cocanvas123}"
export MYSQL_DATABASE="${MYSQL_DATABASE-cocanvas}"

# Defaults for Docker build steps that run Gradle inside a build container.
# Override when your local proxy uses another port:
#   GRADLE_PROXY_PORT=7890 ./run.sh app
# Disable for environments without a proxy:
#   GRADLE_PROXY_HOST= ./run.sh app
export GRADLE_PROXY_HOST="${GRADLE_PROXY_HOST-127.0.0.1}"
export GRADLE_PROXY_PORT="${GRADLE_PROXY_PORT-26797}"

case "$command" in
  dev)
    docker compose up --build
    ;;
  up)
    docker compose up -d --build
    ;;
  app)
    docker compose up -d --build backend
    ;;
  deps)
    docker compose up -d redis mysql
    ;;
  test)
    docker compose run --rm backend-test
    ;;
  config)
    docker compose config
    ;;
  env)
    printf '%s\n' \
      "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME" \
      "BACKEND_HOST_PORT=$BACKEND_HOST_PORT" \
      "REDIS_HOST_PORT=$REDIS_HOST_PORT" \
      "MYSQL_HOST_PORT=$MYSQL_HOST_PORT" \
      "MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD" \
      "MYSQL_DATABASE=$MYSQL_DATABASE" \
      "GRADLE_PROXY_HOST=$GRADLE_PROXY_HOST" \
      "GRADLE_PROXY_PORT=$GRADLE_PROXY_PORT"
    ;;
  down)
    docker compose down
    ;;
  down-all)
    docker compose down
    docker compose --project-name backend down --remove-orphans
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
