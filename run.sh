#!/usr/bin/env bash
set -euo pipefail

# Cocanvas Full-Stack helper.
#
# Usage:
#   ./run.sh dev      Build and start all services in foreground (shows live logs).
#   ./run.sh up       Build and start all services in the background.
#   ./run.sh down     Stop and remove all containers.
#   ./run.sh stop     Stop all containers without removing them.
#   ./run.sh start    Start previously stopped containers.
#   ./run.sh restart  Restart all containers.
#   ./run.sh ps       Show container status.
#   ./run.sh logs     Follow container logs.
#   ./run.sh clean    Stop containers and delete data volumes (e.g. MySQL).

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="$script_dir/$(basename "${BASH_SOURCE[0]}")"

cd "$script_dir"

command="${1:-help}"

# 统一读取 src/backend/.env 作为全局环境变量
if [ -f "src/backend/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "src/backend/.env"
  set +a
fi

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME-cocanvas}"
export NGINX_HOST_PORT="${NGINX_HOST_PORT-8088}"
export REDIS_HOST_PORT="${REDIS_HOST_PORT-6380}"
export MYSQL_HOST_PORT="${MYSQL_HOST_PORT-3307}"
export MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD-cocanvas123}"
export MYSQL_DATABASE="${MYSQL_DATABASE-cocanvas}"

if [ -z "${GRADLE_PROXY_HOST:-}" ] && [ -z "${GRADLE_PROXY_PORT:-}" ]; then
  if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 7890 >/dev/null 2>&1; then
    export GRADLE_PROXY_HOST="host.docker.internal"
    export GRADLE_PROXY_PORT="7890"
    echo "Detected host proxy on 127.0.0.1:7890; Gradle build will use it."
  else
    export GRADLE_PROXY_HOST=""
    export GRADLE_PROXY_PORT=""
  fi
fi

pull_images() {
  echo "Pulling Docker base images..."
  for image in \
    docker/dockerfile:1.7 \
    node:22-alpine \
    eclipse-temurin:21-jdk \
    eclipse-temurin:21-jre \
    nginx:alpine \
    redis:7 \
    mysql:8
  do
    echo "  $image"
    if ! docker pull "$image"; then
      if docker image inspect "$image" >/dev/null 2>&1; then
        echo "Pull failed for $image; using existing local image."
      else
        echo "Failed to pull $image and no local copy is available." >&2
        return 1
      fi
    fi
  done
}

case "$command" in
  dev)
    pull_images
    docker compose up --build
    ;;
  up)
    pull_images
    docker compose up -d --build
    ;;
  pull-images)
    pull_images
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
