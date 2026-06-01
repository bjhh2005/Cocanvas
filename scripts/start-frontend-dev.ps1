$ErrorActionPreference = "Stop"

$appDir = Resolve-Path (Join-Path $PSScriptRoot "..\src\frontend\app")
$viteArgs = "cd /d `"$appDir`" && set VITE_PROXY_TARGET=http://localhost:8088/api&& node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort"

Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", $viteArgs)
