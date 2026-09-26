# Script de preparación del sidecar para el instalador Tauri
# Uso: desde la raíz del monorepo, tras npm run build:server

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ServerDist = Join-Path $Root "apps\server\dist"
$OutDir = Join-Path $Root "apps\desktop\src-tauri\binaries"
$TargetName = "lcds-server-x86_64-pc-windows-msvc.exe"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Empaqueta con npx pkg si está disponible; si no, deja un launcher .cmd de referencia
$Entry = Join-Path $ServerDist "index.js"
if (-not (Test-Path $Entry)) {
  Write-Error "Compile primero: npm run build:server"
}

Write-Host "Intentando empacar sidecar con @yao-pkg/pkg..."
try {
  npx --yes @yao-pkg/pkg@5.16.1 $Entry --targets node20-win-x64 --output (Join-Path $OutDir "lcds-server.exe")
  Copy-Item (Join-Path $OutDir "lcds-server.exe") (Join-Path $OutDir $TargetName) -Force
  Write-Host "Sidecar listo: $OutDir\$TargetName"
} catch {
  Write-Warning "pkg no disponible. Use Node embebido o copie node.exe + dist manualmente."
  @"
@echo off
set LCDS_HOST=127.0.0.1
set LCDS_PORT=47831
node `"%~dp0..\..\server\dist\index.js`"
"@ | Set-Content -Path (Join-Path $OutDir "lcds-server.cmd") -Encoding ASCII
}
