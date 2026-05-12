@echo off
setlocal

rem Cocanvas backend helper for Windows.

cd /d "%~dp0"

set "command=%~1"
if "%command%"=="" set "command=help"
if "%command%"=="-h" set "command=help"
if "%command%"=="--help" set "command=help"

if exist .env (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if not "%%A"=="" if not "%%A"==" " set "%%A=%%B"
    )
)

if "%COMPOSE_PROJECT_NAME%"=="" set "COMPOSE_PROJECT_NAME=cocanvas"
if "%BACKEND_HOST_PORT%"=="" set "BACKEND_HOST_PORT=8080"
if "%REDIS_HOST_PORT%"=="" set "REDIS_HOST_PORT=6379"
if "%MYSQL_HOST_PORT%"=="" set "MYSQL_HOST_PORT=3307"
if "%MYSQL_ROOT_PASSWORD%"=="" set "MYSQL_ROOT_PASSWORD=cocanvas123"
if "%MYSQL_DATABASE%"=="" set "MYSQL_DATABASE=cocanvas"
if "%GRADLE_PROXY_HOST%"=="" set "GRADLE_PROXY_HOST=host.docker.internal"
if "%GRADLE_PROXY_PORT%"=="" set "GRADLE_PROXY_PORT=26797"

if "%command%"=="dev" (
    docker compose up --build
    goto :EOF
)
if "%command%"=="up" (
    docker compose up -d --build
    goto :EOF
)
if "%command%"=="app" (
    docker compose up -d --build backend
    goto :EOF
)
if "%command%"=="deps" (
    docker compose up -d redis mysql
    goto :EOF
)
if "%command%"=="test" (
    docker compose run --rm backend-test
    goto :EOF
)
if "%command%"=="config" (
    docker compose config
    goto :EOF
)
if "%command%"=="env" (
    echo COMPOSE_PROJECT_NAME=%COMPOSE_PROJECT_NAME%
    echo BACKEND_HOST_PORT=%BACKEND_HOST_PORT%
    echo REDIS_HOST_PORT=%REDIS_HOST_PORT%
    echo MYSQL_HOST_PORT=%MYSQL_HOST_PORT%
    echo MYSQL_ROOT_PASSWORD=%MYSQL_ROOT_PASSWORD%
    echo MYSQL_DATABASE=%MYSQL_DATABASE%
    echo GRADLE_PROXY_HOST=%GRADLE_PROXY_HOST%
    echo GRADLE_PROXY_PORT=%GRADLE_PROXY_PORT%
    goto :EOF
)
if "%command%"=="down" (
    docker compose down
    goto :EOF
)
if "%command%"=="down-all" (
    docker compose down
    docker compose --project-name backend down --remove-orphans
    goto :EOF
)
if "%command%"=="stop" (
    docker compose stop
    goto :EOF
)
if "%command%"=="start" (
    docker compose start
    goto :EOF
)
if "%command%"=="restart" (
    docker compose restart
    goto :EOF
)
if "%command%"=="ps" (
    docker compose ps
    goto :EOF
)
if "%command%"=="logs" (
    docker compose logs -f
    goto :EOF
)
if "%command%"=="clean" (
    docker compose down -v
    goto :EOF
)
if "%command%"=="help" (
    echo Cocanvas backend helper.
    echo.
    echo Usage:
    echo   run.bat dev      Build and start Spring Boot, Redis, and MySQL in foreground (shows live logs).
    echo   run.bat up       Build and start Spring Boot, Redis, and MySQL.
    echo   run.bat app      Build and start only Spring Boot with dependencies.
    echo   run.bat deps     Start only Redis and MySQL in the background.
    echo   run.bat test     Run backend tests inside Docker.
    echo   run.bat config   Show resolved Docker Compose config.
    echo   run.bat env      Show current backend environment values.
    echo   run.bat down     Stop and remove containers, keep MySQL data.
    echo   run.bat down-all Stop current and legacy Cocanvas backend containers.
    echo   run.bat stop     Stop containers, keep containers and MySQL data.
    echo   run.bat start    Start previously stopped containers.
    echo   run.bat restart  Restart all backend containers.
    echo   run.bat ps       Show container status.
    echo   run.bat logs     Follow container logs.
    echo   run.bat clean    Stop containers and delete MySQL data volume.
    goto :EOF
)

echo Unknown command: %command% >&2
echo Run run.bat help for usage. >&2
exit /b 1
