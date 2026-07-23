@echo off
setlocal
set "SITE_DIR=%~dp0"
set "NODE_EXE="

where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"
if not defined NODE_EXE if exist "C:\Users\18250447543\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=C:\Users\18250447543\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo Node.js was not found. Please install Node.js LTS, then run this file again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) { Start-Process -FilePath '%NODE_EXE%' -ArgumentList '%SITE_DIR%server.js' -WorkingDirectory '%SITE_DIR%' -WindowStyle Hidden }; Start-Sleep -Seconds 1; Start-Process 'msedge.exe' 'http://localhost:3000'"

if errorlevel 1 (
  echo Failed to launch the site. Keep this window open and try http://localhost:3000 in Edge.
  pause
)
