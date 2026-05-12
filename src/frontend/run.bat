@echo off
setlocal

rem Cocanvas frontend helper for Windows.

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

if "%COMPOSE_PROJECT_NAME%"=="" set "COMPOSE_PROJECT_NAME=cocanvas-frontend"
if "%FRONTEND_HOST_PORT%"=="" set "FRONTEND_HOST_PORT=5173"

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
if "%command%"=="help" (
    echo Cocanvas frontend helper.
    echo.
    echo Usage:
    echo   run.bat dev      Build and start in foreground (shows live logs, Ctrl+C to stop).
    echo   run.bat up       Build and start the frontend container in the background.
    echo   run.bat down     Stop and remove containers.
    echo   run.bat stop     Stop frontend container without removing.
    echo   run.bat start    Start previously stopped frontend container.
    echo   run.bat restart  Restart frontend container.
    echo   run.bat ps       Show container status.
    echo   run.bat logs     Follow container logs.
    goto :EOF
)

echo Unknown command: %command% >&2
echo Run run.bat help for usage. >&2
exit /b 1
