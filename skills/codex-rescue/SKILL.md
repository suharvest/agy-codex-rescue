---
name: codex-rescue
description: Dispatch complex reasoning, stubborn bug diagnosis, deep algorithmic refactoring, and second-opinion code reviews to OpenAI Codex CLI in a safe, sandboxed environment. Use when stuck on a tough bug, needing independent verification of complex logic, or reviewing uncommitted changes.
tools:
  - run_command
---

# Codex Rescue Skill

The `codex-rescue` skill allows an Antigravity agent to invoke OpenAI Codex CLI as a specialized auxiliary reasoning engine while guaranteeing strict sandbox isolation, automatic session tracking, and seamless resume capabilities.

## When to Use Codex Rescue

Use this skill when:
1. **Stubborn or Elusive Bugs**: An issue persists after initial debugging attempts, or involves complex race conditions, memory leaks, or subtle edge cases.
2. **Algorithmic or Architectural Refactoring**: You need high-leverage architectural advice or deep code synthesis for intricate data structures.
3. **Second-Opinion Code Review**: You want an independent audit of uncommitted changes before finalizing work.
4. **Resuming Multi-turn Context**: Continuing a deep investigative thread across multiple queries.

Do **NOT** use when:
- Performing simple file reads or writes that can be done directly with standard agent file tools.
- Running standard bash commands or local tests.

---

## Safety & Sandbox Rules

Safety is strictly enforced at the CLI bridge level:
- **Default Sandbox (`read-only`)**: By default, `codex-rescue` passes `--sandbox read-only --ask-for-approval never`. Codex can inspect files and run read-only commands, but cannot write to disk.
- **Opt-in Write (`workspace-write`)**: Only when the user explicitly requests code modifications or when you need Codex to apply changes, specify `--write`. This enables `--sandbox workspace-write`.
- **Zero Full-Disk Access**: `danger-full-access` and `--dangerously-bypass-approvals-and-sandbox` are strictly prohibited.
- **Process Isolation**: All invocations run through `child_process.spawn` with `shell: false` and array arguments, avoiding shell injection risks.

---

## Command Patterns

All commands are executed via the `run_command` tool.

### 1. Read-Only Diagnosis (Default)
When you need Codex to analyze code without modifying files:
```bash
codex-rescue task "Analyze lib/parser.js and identify why token scanning stalls on nested brackets"
```

### 2. Code Modification Task (`--write`)
When you want Codex to apply code changes directly to the workspace:
```bash
codex-rescue task "Fix the nested bracket parsing bug in lib/parser.js and add edge-case unit tests" --write
```

### 3. Resuming a Previous Session (`--resume`)
To continue discussion from a previous task without repeating context:
```bash
# Resume latest session in the current workspace:
codex-rescue task "Can you optimize the solution for O(1) space?" --resume

# Or resume a specific job ID:
codex-rescue task "Explain line 42 in the diff" --resume job-20261014141000-abc
```

### 4. Code Review of Working Tree (`review`)
To audit uncommitted changes:
```bash
codex-rescue review --scope working-tree
```

To review against a specific base branch or commit:
```bash
codex-rescue review --scope branch --base main
```

### 5. Inspecting Past Jobs
```bash
# Check status of the latest job
codex-rescue status

# List recent jobs
codex-rescue list

# View full artifact output of a job
codex-rescue result job-20261014141000-abc
```

---

## Handling the Output

`codex-rescue` outputs structured Markdown with:
- **🛡️ Execution Summary**: Status, Job ID, Session ID, sandbox mode, duration, and token usage.
- **📋 Verdict**: Core conclusion or error status.
- **🔍 Findings & Analysis**: Technical breakdown and code suggestions.
- **📝 Modified Files**: Clear listing of workspace files changed (or verification that no files were modified).
- **🚀 Next Steps**: Ready-to-copy commands for follow-up or verification.

Always summarize the key findings for the user and reference the `Job ID` for easy continuity.
