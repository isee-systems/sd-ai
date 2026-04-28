@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "FAILED_COMPONENTS="

echo Installing third-party components...
echo.

for /d %%D in ("%SCRIPT_DIR%*") do (
    if exist "%%D\install.bat" (
        echo ================================================
        echo Installing: %%~nxD
        echo ================================================

        call "%%D\install.bat"
        if !errorlevel! equ 0 (
            echo + Successfully installed %%~nxD
            echo.
        ) else (
            echo - Failed to install %%~nxD
            echo.
            set "FAILED_COMPONENTS=!FAILED_COMPONENTS!%%~nxD "
        )
    )
)

echo ================================================
echo Installation Summary
echo ================================================

if "!FAILED_COMPONENTS!"=="" (
    echo + All third-party components installed successfully!
    exit /b 0
) else (
    echo - Failed to install the following components:
    for %%C in (!FAILED_COMPONENTS!) do echo   - %%C
    echo.
    echo Note: Some components may have failed due to missing dependencies.
    echo Check the output above for details.
    exit /b 0
)
