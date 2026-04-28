@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

echo Building causal-chains engine...

where go >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Go toolchain not found. Please install Go to build causal-chains engine.
    exit /b 1
)

cd /d "%SCRIPT_DIR%"
echo Running: go build -o "%SCRIPT_DIR%causal-chains.exe" main.go
go build -o "%SCRIPT_DIR%causal-chains.exe" main.go

echo Successfully built causal-chains binary at %SCRIPT_DIR%causal-chains.exe
exit /b 0
