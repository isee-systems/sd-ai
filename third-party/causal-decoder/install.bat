@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

echo Installing causal-decoder dependencies...

where python3 >nul 2>&1
if %errorlevel% equ 0 (
    set "PYTHON_CMD=python3"
) else (
    where python >nul 2>&1
    if %errorlevel% equ 0 (
        set "PYTHON_CMD=python"
    ) else (
        echo Error: Python not found. Please install Python 3 to use the causal-decoder engine.
        exit /b 1
    )
)

echo Using Python: %PYTHON_CMD%

cd /d "%SCRIPT_DIR%"
%PYTHON_CMD% -m pip install --user -r requirements.txt

echo Successfully installed causal-decoder dependencies
exit /b 0
