# Chesterton demo wrapper (PowerShell / Windows).
#
# Prints the browser tab order for the demo script (docs/outline.md "Demo
# script"), then boots the full stack bare-metal with
# `node e2e/run.mjs --keep-alive` -- same boot logic as the e2e floor test,
# left running instead of torn down. Ctrl+C stops every service.

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

node (Join-Path $Root "scripts\print-tabs.mjs")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Booting the stack (seed --reset, then every service, then the 3 demo PRs fire once each to warm the cache)..."
Write-Host "This runs node e2e/run.mjs --keep-alive. Press Ctrl+C to stop all services."
Write-Host ""

node (Join-Path $Root "e2e\run.mjs") --keep-alive
exit $LASTEXITCODE
