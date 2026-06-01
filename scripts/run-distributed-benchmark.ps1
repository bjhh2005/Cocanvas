$ErrorActionPreference = "Stop"

$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
$logDir = Join-Path $repo ".codex-runlogs"
$outLog = Join-Path $logDir "benchmark.out.log"
$errLog = Join-Path $logDir "benchmark.err.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (Test-Path $outLog) { Remove-Item $outLog -Force }
if (Test-Path $errLog) { Remove-Item $errLog -Force }

Set-Location $repo
$process = Start-Process `
  -FilePath "node" `
  -ArgumentList "scripts/distributed-benchmark-report.mjs" `
  -WorkingDirectory $repo `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Write-Output $process.Id
