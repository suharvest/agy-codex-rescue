# agy-codex-rescue 🛡️

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-brightgreen.svg)](package.json)

> **Safe, sandboxed bridge between Antigravity (`agy`) agent workflows and the OpenAI Codex CLI.**

`agy-codex-rescue` empowers autonomous AI agents (such as Antigravity / Claude) to leverage OpenAI Codex as an auxiliary reasoning engine for complex code synthesis, stubborn bug diagnosis, deep algorithmic refactoring, and independent second-opinion code reviews—**without sacrificing safety or cluttering context**.

---

## 🌟 Why Codex Rescue?

When working on complex software systems, primary coding agents can sometimes get stuck in loops, encounter unfamiliar framework intricacies, or benefit from an independent review. While OpenAI Codex CLI is an exceptionally strong reasoning tool, invoking it raw from an autonomous agent presents critical challenges:

| Challenge | Raw Codex CLI | With `codex-rescue` |
| :--- | :--- | :--- |
| **Sandbox Safety** | Interactive approval prompts or dangerous full-access bypasses | **Default strict read-only sandbox**; workspace writes require explicit opt-in (`--write`) |
| **Execution Security** | Shell interpolation risks and `ARG_MAX` limits | **Process spawning with `shell: false`**; stdin piping prevents shell injection |
| **Session Tracking** | Ephemeral or hard-to-map session UUIDs | **Automatic atomic state persistence**; resume by workspace or job ID (`--resume`) |
| **Output Cleanliness** | Noisy internal Rust tracing logs and debug banners | **Intelligent log filtering**; outputs clean, agent-ready Markdown sections |
| **Agent Tooling** | Manual command crafting needed | **Native Antigravity Skill** (`skills/codex-rescue/SKILL.md`) included out-of-the-box |
| **Dependencies** | Requires complex npm packages or Python wrappers | **Zero external dependencies** (pure Node.js 18+ standard library) |

---

## 🏗️ Architecture

```
   ┌──────────────────────────────────────────────┐
   │         Antigravity Agent (`agy`)            │
   └──────────────────────┬───────────────────────┘
                          │ Skill / run_command
                          ▼
   ┌──────────────────────────────────────────────┐
   │            bin/codex-rescue CLI              │
   ├──────────────────────┬───────────────────────┤
   │  lib/engine.mjs      │  lib/state.mjs        │
   │  - Strict Sandboxing │  - Atomic jobs.json   │
   │  - Stdin Prompt Pipe │  - Session Resolution │
   │  - Event Streamer    │  - Artifact Store     │
   └──────────┬───────────┴───────────┬───────────┘
              │ Spawn (shell: false)  │ Render
              ▼                       ▼
   ┌──────────────────────┐  ┌────────────────────┐
   │   OpenAI Codex CLI   │  │   lib/render.mjs   │
   │  (--sandbox read-only│  │   - Log Sanitizer  │
   │   -a never exec)     │  │   - Markdown Model │
   └──────────────────────┘  └────────────────────┘
```

---

## 🚀 Quick Start & Installation

### Option 1: One-Line Installer (Recommended)

Run the idempotent installer script:
```bash
bash install.sh
```

The installer will:
1. Symlink `bin/codex-rescue` into `~/.local/bin/codex-rescue` (or `$PREFIX/bin`).
2. Link the Antigravity Skill into:
   - `~/.gemini/antigravity-cli/skills/codex-rescue`
   - `~/.gemini/config/skills/codex-rescue`
   - `~/.claude/skills/codex-rescue` (if directory exists).
3. Run environment validation checks.

### Option 2: Local Package Link

```bash
cd /path/to/agy-codex-rescue
npm link
```

### Verify Environment Readiness

Check if your environment is fully configured:
```bash
codex-rescue setup
```

Expected output:
```text
=====================================
 🛡️  CODEX-RESCUE ENVIRONMENT SETUP  
=====================================
 [PASS]  Node.js Runtime: v22.23.1 (compatible >= 18)
 [PASS]  Git Version Control: git version 2.43.0
 [PASS]  Codex CLI Executable: /home/harvest/.rpty/bin/codex (codex-cli 0.162.1)
 [PASS]  Codex Authentication: Logged in using ChatGPT
 [PASS]  State Store Directory: Writable at /home/harvest/.config/agy-codex-rescue
-------------------------------------
Result: Ready to use! Codex rescue bridge is properly configured.
=====================================
```

---

## 💻 CLI Usage & Commands

### 1. `task` — Execute Analysis or Code Synthesis

```bash
codex-rescue task "<prompt>" [options]
```

#### Flags:
- `--write`: Enable `workspace-write` sandbox. (DEFAULT: strict `read-only`).
- `--resume [job-id]`: Resume previous session (defaults to the most recent job in current workspace).
- `--fresh`: Force a fresh session even if prior sessions exist.
- `--model <name>`: Override Codex model (e.g. `o3-mini`).
- `--effort <level>`: Set reasoning effort level (`low`, `medium`, `high`).
- `--dir <path>`: Target workspace directory (default: current working directory).
- `--json`: Output machine-readable JSON object.

#### Examples:
```bash
# Safe read-only diagnosis:
codex-rescue task "Analyze why memory increases in WebSocket reconnection handler"

# Authorize workspace modifications:
codex-rescue task "Refactor auth middleware to handle expired refresh tokens" --write

# Resume previous investigation:
codex-rescue task "Are there any edge cases with concurrent requests?" --resume
```

### 2. `review` — Automated Code Review

Audit changes in the current Git repository:
```bash
# Review uncommitted changes:
codex-rescue review --scope working-tree

# Review against main branch:
codex-rescue review --scope branch --base main
```

### 3. `status` & `result` — Job Inspection

```bash
# Inspect status of the latest job in this workspace
codex-rescue status

# View the full markdown result artifact for a specific job
codex-rescue result job-20261014141000-abc
```

### 4. `list` — View Recent Job History

```bash
codex-rescue list
```

---

## 🤖 Using with Antigravity Agent (`agy`)

When the skill is linked, `agy` automatically understands how to leverage `codex-rescue`.

### Typical Agent Interaction:

```text
User: "I have a weird race condition in my cache invalidation logic in cache.go. Can you get a second opinion?"

Agent invokes:
run_command("codex-rescue task 'Audit cache.go for race conditions during concurrent eviction' --dir .")

Codex Rescue returns structured Markdown:
## 🛡️ Codex Rescue Execution Summary
- Status: ✅ Success
- Mode / Sandbox: task / read-only
- Duration: 6.42s

## 📋 Verdict
Potential race condition detected on cache.go:88 where mutex is unlocked before map read completes.

## 🔍 Findings & Analysis
...

Agent applies or discusses the findings with the user.
```

---

## 🔒 Security & Sandbox Guarantees

1. **Read-Only By Default**: Codex is invoked with `--sandbox read-only --ask-for-approval never`. Model commands cannot alter disk state.
2. **Explicit Workspace Write**: Only with `--write` does it switch to `--sandbox workspace-write`.
3. **No Root / Danger Bypasses**: `danger-full-access` and bypass flags are strictly blocked.
4. **Shell Injection Protection**: Uses `child_process.spawn` with `shell: false` and arguments array.
5. **Atomic Persistence**: State writes use temporary file creation and atomic POSIX rename.

See [SECURITY.md](file:///home/harvest/project/agy-codex-rescue/SECURITY.md) for full policy.

---

## 🧪 Testing

Run the offline unit and functional test suite:
```bash
npm test
```

Run the complete integration smoke test:
```bash
npm run smoke
```

---

## 📄 License

[MIT](file:///home/harvest/project/agy-codex-rescue/LICENSE) © 2026 harvest
