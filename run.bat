@echo off
setlocal

rem Cocanvas root helper for Windows.
rem This script manages the entire full-stack application (Frontend + Backend + Nginx + DBs).

cd /d "%~dp0"

set "command=%~1"
if "%command%"=="" set "command=help"
if "%command%"=="-h" set "command=help"
if "%command%"=="--help" set "command=help"

rem 统一读取 src\backend\.env 作为全局环境变量
if exist "src\backend\.env" (
    for /f "usebackq tokens=1,* delims==" %%A in ("src\backend\.env") do (
        if not "%%A"=="" if not "%%A"==" " set "%%A=%%B"
    )
)

if "%COMPOSE_PROJECT_NAME%"=="" set "COMPOSE_PROJECT_NAME=cocanvas"
if "%REDIS_HOST_PORT%"=="" set "REDIS_HOST_PORT=6379"
if "%MYSQL_HOST_PORT%"=="" set "MYSQL_HOST_PORT=3307"
if "%MYSQL_ROOT_PASSWORD%"=="" set "MYSQL_ROOT_PASSWORD=cocanvas123"
if "%MYSQL_DATABASE%"=="" set "MYSQL_DATABASE=cocanvas"
if "%GRADLE_PROXY_HOST%"=="" set "GRADLE_PROXY_HOST=host.docker.internal"
if "%GRADLE_PROXY_PORT%"=="" set "GRADLE_PROXY_PORT=7890"

if "%command%"=="dev" (
    docker compose up --build
    goto :EOF
)
if "%command%"=="up" (
    docker compose up -d --build
    goto :EOF
)
if "%command%"=="down" (
    docker compose down
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
    echo Cocanvas Full-Stack helper.
    echo.
    echo Usage:
    echo   run.bat dev      Build and start all services in foreground ^(shows live logs^).
    echo   run.bat up       Build and start all services in the background.
    echo   run.bat down     Stop and remove all containers.
    echo   run.bat stop     Stop all containers without removing them.
    echo   run.bat start    Start previously stopped containers.
    echo   run.bat restart  Restart all containers.
    echo   run.bat ps       Show container status.
    echo   run.bat logs     Follow container logs.
    echo   run.bat clean    Stop containers and delete data volumes ^(e.g. MySQL^).
    goto :EOF
)

echo Unknown command: %command% >&2
echo Run run.bat help for usage. >&2
exit /b 1
