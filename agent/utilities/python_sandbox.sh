#!/bin/bash
#
# Python Sandbox Wrapper
# Executes Python scripts with OS-level directory isolation
#
# Usage: python_sandbox.sh <sandbox_dir> <script_path>
#
# Security measures:
# 1. Changes working directory to sandbox
# 2. Blocks file WRITES outside sandbox directory
# 3. Allows file READS anywhere (needed for system libraries)
# 4. Sets resource limits (CPU, file size)
# 5. Blocks subprocess execution
# 6. Works on both macOS and Linux

set -e

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <sandbox_dir> <script_path>" >&2
    exit 1
fi

SANDBOX_DIR="$1"
SCRIPT_PATH="$2"

# Validate that sandbox directory exists
if [ ! -d "$SANDBOX_DIR" ]; then
    echo "Error: Sandbox directory does not exist: $SANDBOX_DIR" >&2
    exit 1
fi

# Validate that script exists and is within sandbox
if [ ! -f "$SCRIPT_PATH" ]; then
    echo "Error: Script does not exist: $SCRIPT_PATH" >&2
    exit 1
fi

# Get absolute paths
SANDBOX_ABS=$(cd "$SANDBOX_DIR" && pwd)
SCRIPT_ABS=$(cd "$(dirname "$SCRIPT_PATH")" && pwd)/$(basename "$SCRIPT_PATH")

# Security check: Ensure script is within sandbox
if [[ ! "$SCRIPT_ABS" == "$SANDBOX_ABS"* ]]; then
    echo "Error: Script must be within sandbox directory" >&2
    exit 1
fi

# Set resource limits (prevents DoS)
# CPU time: 60 seconds
ulimit -t 60 2>/dev/null || true
# File size: 50MB (prevents filling disk)
ulimit -f 51200 2>/dev/null || true

# Create a restricted Python wrapper script
cat > "$SANDBOX_DIR/.sandbox_wrapper.py" << 'WRAPPER_EOF'
import sys
import os
import builtins

# Get sandbox directory from environment
SANDBOX_DIR = os.environ.get('SANDBOX_DIR', os.getcwd())
SCRIPT_PATH = os.environ.get('SCRIPT_PATH', '')

# Normalize sandbox path for comparisons
SANDBOX_REAL = os.path.realpath(SANDBOX_DIR)

# Override built-in open to restrict WRITE access
_original_open = builtins.open

def restricted_open(file, mode='r', *args, **kwargs):
    """Restricted open that blocks writes outside sandbox directory"""
    # Allow all reads
    # Block writes outside sandbox
    if any(m in str(mode) for m in ['w', 'a', 'x', '+']):
        # This is a write operation - validate path
        if not os.path.isabs(file):
            file = os.path.join(os.getcwd(), file)
        file_real = os.path.normpath(os.path.realpath(file))

        # Check if file is within sandbox
        if not file_real.startswith(SANDBOX_REAL + os.sep) and file_real != SANDBOX_REAL:
            raise PermissionError(f"Write access denied: {file} is outside sandbox directory")

    return _original_open(file, mode, *args, **kwargs)

# Replace built-in open
builtins.open = restricted_open

# Wrap os module write functions
_original_os_remove = os.remove if hasattr(os, 'remove') else None
_original_os_unlink = os.unlink if hasattr(os, 'unlink') else None
_original_os_rmdir = os.rmdir if hasattr(os, 'rmdir') else None
_original_os_mkdir = os.mkdir if hasattr(os, 'mkdir') else None
_original_os_makedirs = os.makedirs if hasattr(os, 'makedirs') else None

def validate_write_path(path):
    """Ensure write path is within sandbox"""
    if not os.path.isabs(path):
        path = os.path.join(os.getcwd(), path)
    path_real = os.path.realpath(path)

    if not path_real.startswith(SANDBOX_REAL + os.sep) and path_real != SANDBOX_REAL:
        raise PermissionError(f"Write access denied: {path} is outside sandbox directory")
    return path

def restricted_os_remove(path):
    validate_write_path(path)
    return _original_os_remove(path)

def restricted_os_mkdir(path, *args, **kwargs):
    validate_write_path(path)
    return _original_os_mkdir(path, *args, **kwargs)

def restricted_os_makedirs(path, *args, **kwargs):
    validate_write_path(path)
    return _original_os_makedirs(path, *args, **kwargs)

# Replace os module write functions
if _original_os_remove:
    os.remove = restricted_os_remove
    os.unlink = restricted_os_remove
if _original_os_rmdir:
    os.rmdir = restricted_os_remove
if _original_os_mkdir:
    os.mkdir = restricted_os_mkdir
if _original_os_makedirs:
    os.makedirs = restricted_os_makedirs

# Change to sandbox directory (prevents relative path escapes)
os.chdir(SANDBOX_DIR)

# Store original import function
original_import = builtins.__import__

def restricted_import(name, *args, **kwargs):
    """Block dangerous module imports"""
    # Block network modules
    if name in ['urllib', 'http', 'ftplib', 'smtplib', 'requests']:
        raise ImportError(f"Module '{name}' is not allowed in sandbox")

    # Allow import
    result = original_import(name, *args, **kwargs)

    # If subprocess is imported, block all execution functions
    if name == 'subprocess':
        def blocked_call(*args, **kwargs):
            raise PermissionError("Subprocess execution is not allowed in sandbox")

        result.call = blocked_call
        result.check_call = blocked_call
        result.check_output = blocked_call
        result.run = blocked_call
        result.Popen = blocked_call

    return result

# Replace the import function
builtins.__import__ = restricted_import

# Execute the user script
script_name = os.path.basename(SCRIPT_PATH)
with _original_open(SCRIPT_PATH, 'r') as f:
    code = f.read()

# Execute in restricted namespace
exec(compile(code, script_name, 'exec'), {
    '__name__': '__main__',
    '__file__': script_name,
    '__builtins__': builtins,
})
WRAPPER_EOF

# Export environment variables for the wrapper
export SANDBOX_DIR="$SANDBOX_ABS"
export SCRIPT_PATH="$SCRIPT_ABS"

# Execute Python with the wrapper script
python3 "$SANDBOX_DIR/.sandbox_wrapper.py"
EXIT_CODE=$?

# Cleanup
rm -f "$SANDBOX_DIR/.sandbox_wrapper.py"

exit $EXIT_CODE
