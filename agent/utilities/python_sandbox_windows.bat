@echo off
REM Python Sandbox Wrapper for Windows
REM
REM !! WARNING !!
REM This Windows sandbox provides MINIMAL security and is NOT production-ready.
REM It is intended for LOCAL DEVELOPMENT ONLY.
REM DO NOT use this for publicly hosted services.
REM
REM For production deployments, use Linux/macOS with the bash sandbox script.
REM
REM Usage: python_sandbox_windows.bat <sandbox_dir> <script_path>

if "%~2"=="" (
    echo Usage: %0 ^<sandbox_dir^> ^<script_path^> 1>&2
    exit /b 1
)

set SANDBOX_DIR=%~1
set SCRIPT_PATH=%~2

REM Validate that sandbox directory exists
if not exist "%SANDBOX_DIR%" (
    echo Error: Sandbox directory does not exist: %SANDBOX_DIR% 1>&2
    exit /b 1
)

REM Validate that script exists
if not exist "%SCRIPT_PATH%" (
    echo Error: Script does not exist: %SCRIPT_PATH% 1>&2
    exit /b 1
)

REM Get absolute paths
pushd "%SANDBOX_DIR%"
set SANDBOX_ABS=%CD%
popd

pushd "%SCRIPT_PATH%\.."
set SCRIPT_DIR=%CD%
popd
set SCRIPT_NAME=%~nx2
set SCRIPT_ABS=%SCRIPT_DIR%\%SCRIPT_NAME%

REM Security check: Ensure script is within sandbox
echo %SCRIPT_ABS% | findstr /C:"%SANDBOX_ABS%" >nul
if errorlevel 1 (
    echo Error: Script must be within sandbox directory 1>&2
    exit /b 1
)

REM Create a restricted Python wrapper script
(
echo import sys
echo import os
echo import builtins
echo.
echo # !! WARNING: Windows sandbox provides minimal security !!
echo # For production use, deploy on Linux/macOS
echo.
echo SANDBOX_DIR = os.environ.get^('SANDBOX_DIR', os.getcwd^(^)^)
echo SCRIPT_PATH = os.environ.get^('SCRIPT_PATH', ''^)
echo SANDBOX_REAL = os.path.realpath^(SANDBOX_DIR^)
echo.
echo _original_open = builtins.open
echo.
echo def restricted_open^(file, mode='r', *args, **kwargs^):
echo     """Restricted open that blocks writes outside sandbox directory"""
echo     if any^(m in str^(mode^) for m in ['w', 'a', 'x', '+']^):
echo         if not os.path.isabs^(file^):
echo             file = os.path.join^(os.getcwd^(^), file^)
echo         file_real = os.path.normpath^(os.path.realpath^(file^)^)
echo         if not file_real.startswith^(SANDBOX_REAL + os.sep^) and file_real != SANDBOX_REAL:
echo             raise PermissionError^(f"Write access denied: {file} is outside sandbox directory"^)
echo     return _original_open^(file, mode, *args, **kwargs^)
echo.
echo builtins.open = restricted_open
echo.
echo _original_os_remove = os.remove if hasattr^(os, 'remove'^) else None
echo _original_os_mkdir = os.mkdir if hasattr^(os, 'mkdir'^) else None
echo _original_os_makedirs = os.makedirs if hasattr^(os, 'makedirs'^) else None
echo.
echo def validate_write_path^(path^):
echo     if not os.path.isabs^(path^):
echo         path = os.path.join^(os.getcwd^(^), path^)
echo     path_real = os.path.realpath^(path^)
echo     if not path_real.startswith^(SANDBOX_REAL + os.sep^) and path_real != SANDBOX_REAL:
echo         raise PermissionError^(f"Write access denied: {path} is outside sandbox directory"^)
echo     return path
echo.
echo def restricted_os_remove^(path^):
echo     validate_write_path^(path^)
echo     return _original_os_remove^(path^)
echo.
echo def restricted_os_mkdir^(path, *args, **kwargs^):
echo     validate_write_path^(path^)
echo     return _original_os_mkdir^(path, *args, **kwargs^)
echo.
echo def restricted_os_makedirs^(path, *args, **kwargs^):
echo     validate_write_path^(path^)
echo     return _original_os_makedirs^(path, *args, **kwargs^)
echo.
echo if _original_os_remove:
echo     os.remove = restricted_os_remove
echo     os.unlink = restricted_os_remove
echo if _original_os_mkdir:
echo     os.mkdir = restricted_os_mkdir
echo if _original_os_makedirs:
echo     os.makedirs = restricted_os_makedirs
echo.
echo os.chdir^(SANDBOX_DIR^)
echo.
echo original_import = builtins.__import__
echo.
echo def restricted_import^(name, *args, **kwargs^):
echo     if name in ['urllib', 'http', 'ftplib', 'smtplib', 'requests']:
echo         raise ImportError^(f"Module '{name}' is not allowed in sandbox"^)
echo     result = original_import^(name, *args, **kwargs^)
echo     if name == 'subprocess':
echo         def blocked_call^(*args, **kwargs^):
echo             raise PermissionError^("Subprocess execution is not allowed in sandbox"^)
echo         result.call = blocked_call
echo         result.check_call = blocked_call
echo         result.check_output = blocked_call
echo         result.run = blocked_call
echo         result.Popen = blocked_call
echo     return result
echo.
echo builtins.__import__ = restricted_import
echo.
echo script_name = os.path.basename^(SCRIPT_PATH^)
echo with _original_open^(SCRIPT_PATH, 'r'^) as f:
echo     code = f.read^(^)
echo.
echo exec^(compile^(code, script_name, 'exec'^), {
echo     '__name__': '__main__',
echo     '__file__': script_name,
echo     '__builtins__': builtins,
echo }^)
) > "%SANDBOX_DIR%\.sandbox_wrapper.py"

REM Export environment variables
set SANDBOX_DIR=%SANDBOX_ABS%
set SCRIPT_PATH=%SCRIPT_ABS%

REM Execute Python with the wrapper script
python "%SANDBOX_DIR%\.sandbox_wrapper.py"
set EXIT_CODE=%ERRORLEVEL%

REM Cleanup
del "%SANDBOX_DIR%\.sandbox_wrapper.py" 2>nul

exit /b %EXIT_CODE%
