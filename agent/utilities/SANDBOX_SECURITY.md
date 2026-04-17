# Python Sandbox Security

This document describes the security implementation for Python script execution in the VisualizationEngine.

## Overview

The VisualizationEngine executes user-generated and AI-generated Python code to create matplotlib visualizations. To prevent security vulnerabilities, all Python execution is sandboxed at the OS level.

## Security Guarantees

### What is Protected

- **Write Operations**: Python scripts cannot write files outside their session directory
- **File Deletion**: Scripts cannot delete files outside their session directory
- **Directory Creation**: Scripts cannot create directories outside their session directory
- **Subprocess Execution**: All subprocess/shell command execution is blocked
- **Network Access**: Network modules (urllib, requests, etc.) are blocked from import
- **Path Traversal**: `../../../` style attacks are prevented
- **Symlink Escapes**: Symbolic links cannot be used to escape the sandbox

### What is Allowed

- **Reading Files**: Scripts can read system libraries (needed for matplotlib, numpy, etc.)
- **Writing in Sandbox**: Full read/write access within the session directory
- **Resource Limits**: CPU time (60s) and file size (50MB) limits enforced via ulimit

## Platform Support

### Linux (Production)

**Sandbox Script**: `python_sandbox.sh`

**Security Features**:
- OS-level path validation
- ulimit resource constraints (CPU time, file size)
- Python built-in function wrapping (`open`, `os.*`)
- Module import restrictions
- Working directory isolation

**Deployment**: Safe for production use, including publicly hosted services.

### macOS (Development/Testing)

**Sandbox Script**: `python_sandbox.sh`

**Security Features**: Same as Linux

**Deployment**: Suitable for local development and testing. For production deployments, use Linux.

### Windows (Development Only - WARNING)

**Sandbox Script**: `python_sandbox_windows.bat`

**Security Features**:
- Python function wrapping (file operations, imports)
- Path validation
- WARNING: NO ulimit support (Windows doesn't have ulimit)
- WARNING: NO process-level isolation

**Deployment**:
- Safe for **local development only**
- **NOT SAFE** for production
- **DO NOT** use for publicly hosted services
- The system will print warnings when running on Windows

**Recommendation**: For production deployments, use **Linux only**.

## Implementation Details

### Two-Layer Security

1. **Node.js Layer** ([VisualizationEngine.js](./VisualizationEngine.js))
   - Path validation before file operations
   - Prevents path traversal at application level
   - Validates all paths are within session temp directory

2. **Python Layer** (sandbox scripts)
   - Wraps built-in `open()` function to block writes outside sandbox
   - Wraps `os.remove()`, `os.mkdir()`, etc.
   - Blocks dangerous module imports
   - Neuters subprocess execution functions

### Session Isolation

Each WebSocket session gets its own temp directory:
```
/tmp/sd-agent/
  ├── sess_abc123/  ← Session 1 sandbox
  ├── sess_def456/  ← Session 2 sandbox
  └── sess_ghi789/  ← Session 3 sandbox
```

Sessions cannot access each other's files.

### Configurable Temp Directory

Set via environment variable:
```bash
export SESSION_TEMP_DIR=/custom/temp/path
```

Or in `.env`:
```
SESSION_TEMP_DIR=/custom/temp/path
```

## Testing

Unit tests verify all security guarantees:

```bash
npm test -- tests/agent/sandbox.test.js
```

Tests cover:
- File write blocking outside sandbox
- File read permissions
- Subprocess execution blocking
- Network module blocking
- Resource limits
- Path traversal prevention
- Symlink escape prevention
- Matplotlib compatibility

## Third-Party Alternatives

For enhanced security on Linux, consider wrapping with:

- **Bubblewrap**: Lightweight container sandbox
- **Firejail**: Application sandboxing
- **Docker/Podman**: Full containerization (more overhead)
- **gVisor**: Google's container runtime sandbox

Our custom solution was chosen for:
- Cross-platform support (macOS, Linux, Windows dev)
- Zero external dependencies
- Lightweight (no Docker overhead)
- Simple deployment

## Security Considerations

### Matplotlib & System Libraries

Matplotlib requires reading system files (fonts, config files). The sandbox allows:
- Read access to `/usr/`, `/Library/`, `/System/` (system paths)
- Read access to `~/.matplotlib/`, `~/.fonts/` (user config)
- **NO write access** to these locations

### AI-Generated Code

When using `useAICustom: true`, the AI generates Python visualization code. The sandbox prevents:
- Data exfiltration attempts
- Malicious code injection
- Resource exhaustion attacks

### Resource Exhaustion

**Linux/macOS**: ulimit enforces CPU time (60s) and file size (50MB) limits.

**Windows**: No ulimit support. Use process timeout (70s) as fallback. For production, use Linux.

## Migration from Development to Production

If developing on Windows:

1. Test locally on Windows (warnings will appear)
2. Deploy to Linux or macOS for production
3. Verify tests pass: `npm test -- tests/agent/sandbox.test.js`
4. Monitor logs for security violations

## Reporting Security Issues

If you discover a security vulnerability, please report it via:
- GitHub Issues (for non-critical issues)
- Direct contact for critical vulnerabilities

## License

Same license as the main project.
