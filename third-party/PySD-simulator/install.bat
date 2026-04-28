@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

echo Installing PySD simulator dependencies...

where python3 >nul 2>&1
if %errorlevel% equ 0 (
    set "PYTHON_CMD=python3"
) else (
    where python >nul 2>&1
    if %errorlevel% equ 0 (
        set "PYTHON_CMD=python"
    ) else (
        echo Error: Python not found. Please install Python 3 to use the PySD simulator.
        exit /b 1
    )
)

echo Using Python: %PYTHON_CMD%

cd /d "%SCRIPT_DIR%"
%PYTHON_CMD% -m pip install  -r requirements.txt

echo Successfully installed PySD simulator dependencies
exit /b 0
