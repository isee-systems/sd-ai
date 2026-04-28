@echo off
setlocal enabledelayedexpansion

rem Set SKIP_THIRD_PARTY_COMPONENTS to a comma-separated list of component names to skip.
rem Example: set SKIP_THIRD_PARTY_COMPONENTS=causal-decoder,PySD-simulator,time-series-behavior-analysis && npm install

set "SCRIPT_DIR=%~dp0"
set "FAILED_COMPONENTS="

echo Installing third-party components...
echo.

for /d %%D in ("%SCRIPT_DIR%*") do (
    if exist "%%D\install.bat" (
        set "COMPONENT_NAME=%%~nxD"
        set "SKIP_THIS="

        for %%S in ("%SKIP_THIRD_PARTY_COMPONENTS:,=" "%") do (
            if /i "%%~S"=="!COMPONENT_NAME!" set "SKIP_THIS=1"
        )

        if defined SKIP_THIS (
            echo ================================================
            echo Skipping: !COMPONENT_NAME!
            echo ================================================
            echo.
        ) else (
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
