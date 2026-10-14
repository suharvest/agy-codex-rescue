# Security Policy

## Security Model & Principles

`agy-codex-rescue` bridges the Antigravity agent workflow (`agy`) with the OpenAI Codex CLI. It is engineered from the ground up for safe, sandboxed, and verifiable execution.

### 1. Sandbox Policy & Boundaries

- **Default Read-Only Sandbox**: By default, every `task` and `review` invocation is executed with:
  ```bash
  --sandbox read-only --ask-for-approval never
  ```
  In this mode, model-generated shell commands are strictly prevented from writing to disk, altering files, or making persistent system changes.
- **Explicit Opt-In for Workspace Modification**: File modification is permitted only when `--write` is explicitly passed by the caller:
  ```bash
  --sandbox workspace-write --ask-for-approval never
  ```
  This restricts writes strictly to the target repository workspace root.
- **Strict Prohibition of Full Access**: The dangerous Codex modes (`danger-full-access` and `--dangerously-bypass-approvals-and-sandbox`) are completely disallowed and rejected by `agy-codex-rescue`.

### 2. Subprocess & Command Execution Safety

- **No Shell Execution**: Processes are invoked strictly via `child_process.spawn` with `shell: false` and fixed string argument arrays.
- **Injection Prevention**: Prompts and user inputs are passed via `stdin` or managed temporary files rather than command-line arguments, eliminating shell escaping vulnerabilities and operating system argument length limitations (`ARG_MAX`).
- **Safe Session Resolution**: Session resumption strictly checks valid session IDs and fails closed if an ID is missing, corrupt, or ambiguous.

### 3. State & Artifact Storage Security

- **Atomic Writes**: State files (`jobs.json`) are updated using atomic temporary file creation followed by `fs.renameSync` on the same filesystem, preventing half-written or corrupted state files during power loss or abrupt termination.
- **Strict Permissions**: State directories and job metadata files are created with restricted file permissions (`0o700` / `0o600`).
- **Path Sanitization**: Artifact filenames are sanitized to prevent directory traversal attacks (`../`).

## Reporting Security Vulnerabilities

If you discover a security vulnerability or sandbox bypass in `agy-codex-rescue`:
1. Do **NOT** disclose the vulnerability publicly in public issue trackers.
2. Report the issue confidentially with proof of concept and reproduction steps.
3. Vulnerabilities will be triaged, patched, and acknowledged with highest priority.
