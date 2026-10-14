import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import {
  createJob,
  updateJob,
  resolveResumeSession,
  saveArtifact,
  ensureStateDir
} from './state.mjs';

/**
 * Locate the codex binary in PATH or known fallback locations.
 */
export function findCodexBin() {
  if (process.env.CODEX_BIN && fs.existsSync(process.env.CODEX_BIN)) {
    return process.env.CODEX_BIN;
  }

  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, 'codex');
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore access error
    }
  }

  const fallbackPaths = [
    path.join(os.homedir(), '.local', 'bin', 'codex'),
    path.join(os.homedir(), '.rpty', 'bin', 'codex'),
    path.join(os.homedir(), '.codex', 'packages', 'standalone', 'current', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/usr/bin/codex'
  ];

  for (const candidate of fallbackPaths) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Get git modified/untracked files relative to directory.
 */
export function getGitStatus(cwd) {
  try {
    const res = spawnSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      shell: false
    });
    if (res.status !== 0 || !res.stdout) {
      return [];
    }
    return res.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.slice(3).trim());
  } catch {
    return [];
  }
}

/**
 * Check if git repo has uncommitted changes.
 */
export function hasGitUncommitted(cwd) {
  const status = getGitStatus(cwd);
  return status.length > 0;
}

/**
 * Check if directory is inside a git repository.
 */
export function isGitRepo(cwd) {
  try {
    const res = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf8',
      shell: false
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Build arguments array for codex invocation.
 */
export function buildCodexArgs({
  mode = 'task',
  write = false,
  resumeSessionId = null,
  reviewScope = 'auto',
  reviewBase = null,
  dir = process.cwd(),
  model = null,
  effort = null,
  outputFile = null
}) {
  const args = [];

  // Sandbox policy: strict enforcement
  // Default is always 'read-only'. Only 'workspace-write' if write is true.
  // Never allow danger-full-access.
  const sandbox = write ? 'workspace-write' : 'read-only';
  args.push('-s', sandbox);

  // Approval policy: never pause for prompt
  args.push('-a', 'never');

  // Subcommand
  args.push('exec');

  if (mode === 'task') {
    if (resumeSessionId) {
      args.push('resume');
      if (!isGitRepo(dir)) {
        args.push('--skip-git-repo-check');
      }
      if (outputFile) {
        args.push('-o', outputFile);
      }
      args.push('--json');
      if (model) {
        args.push('-m', model);
      }
      args.push(resumeSessionId);
      // Prompt read from stdin
      args.push('-');
    } else {
      // Fresh or standard task
      args.push('-C', dir);
      if (!isGitRepo(dir)) {
        args.push('--skip-git-repo-check');
      }
      if (outputFile) {
        args.push('-o', outputFile);
      }
      args.push('--json');
      if (model) {
        args.push('-m', model);
      }
      if (effort) {
        args.push('-c', `model_reasoning_effort="${effort}"`);
      }
      // Prompt read from stdin
      args.push('-');
    }
  } else if (mode === 'review') {
    args.push('review');
    if (outputFile) {
      args.push('-o', outputFile);
    }
    args.push('--json');
    if (model) {
      args.push('-m', model);
    }

    let isUncommitted = false;
    if (reviewScope === 'working-tree') {
      args.push('--uncommitted');
      isUncommitted = true;
    } else if (reviewScope === 'branch') {
      args.push('--base', reviewBase || 'HEAD~1');
    } else {
      // auto: if uncommitted changes exist, review uncommitted; else compare base
      if (hasGitUncommitted(dir)) {
        args.push('--uncommitted');
        isUncommitted = true;
      } else {
        args.push('--base', reviewBase || 'HEAD~1');
      }
    }

    // Codex CLI review does not accept [PROMPT] with --uncommitted
    if (!isUncommitted) {
      args.push('-');
    }
  } else {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  return { args, sandbox };
}

/**
 * Execute Codex child process safely.
 */
export function runCodexProcess({
  codexBin,
  args,
  dir,
  prompt = '',
  outputFile = null,
  onEvent = null
}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let threadId = null;
    let agentMessageParts = [];
    let usage = null;
    let rawStderr = '';

    const child = spawn(codexBin, args, {
      cwd: dir,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Feed prompt via stdin and close stdin stream
    if (child.stdin) {
      child.stdin.setDefaultEncoding('utf8');
      child.stdin.write(prompt || ' ');
      child.stdin.end();
    }

    // Process stdout JSONL line by line
    if (child.stdout) {
      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            const ev = JSON.parse(trimmed);
            if (onEvent) onEvent(ev);

            if (ev.type === 'thread.started' && ev.thread_id) {
              threadId = ev.thread_id;
            } else if (ev.type === 'item.completed' && ev.item) {
              if (ev.item.type === 'agent_message' && typeof ev.item.text === 'string') {
                agentMessageParts.push(ev.item.text);
              }
            } else if (ev.type === 'turn.completed' && ev.usage) {
              usage = ev.usage;
            }
          } catch {
            // Non-JSON line on stdout: pass through
          }
        }
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        rawStderr += chunk.toString('utf8');
      });
    }

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime;
      resolve({
        exitCode: 1,
        threadId,
        resultText: '',
        rawStderr: `${rawStderr}\nSpawn error: ${err.message}`.trim(),
        usage,
        durationMs
      });
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      let finalResultText = '';

      // Primary source: check output file
      if (outputFile && fs.existsSync(outputFile)) {
        try {
          finalResultText = fs.readFileSync(outputFile, 'utf8');
        } catch {
          // ignore read error
        }
      }

      // Fallback: check collected agent message parts from stdout
      if (!finalResultText && agentMessageParts.length > 0) {
        finalResultText = agentMessageParts.join('\n\n');
      }

      resolve({
        exitCode: code ?? 0,
        threadId,
        resultText: finalResultText,
        rawStderr,
        usage,
        durationMs
      });
    });
  });
}

/**
 * Execute a task with Codex.
 */
export async function executeTask({
  prompt,
  write = false,
  resume = null,
  fresh = false,
  model = null,
  effort = null,
  dir = process.cwd(),
  onEvent = null
}) {
  const targetDir = path.resolve(dir);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Directory does not exist: ${targetDir}`);
  }

  const codexBin = findCodexBin();
  if (!codexBin) {
    throw new Error('Codex CLI executable not found in PATH or standard installation directories.');
  }

  if (fresh && resume) {
    throw new Error('Conflicting options: cannot use both --fresh and --resume.');
  }

  let resumeSessionId = null;
  let resumedJob = null;
  if (resume) {
    const query = typeof resume === 'string' ? resume : null;
    const resolved = resolveResumeSession(query, targetDir);
    resumeSessionId = resolved.sessionId;
    resumedJob = resolved.job;
  }

  // Create state directory and temp output file
  const { artifactsDir } = ensureStateDir();
  const tmpOutputFile = path.join(
    artifactsDir,
    `tmp-out-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  );

  const { args, sandbox } = buildCodexArgs({
    mode: 'task',
    write,
    resumeSessionId,
    dir: targetDir,
    model,
    effort,
    outputFile: tmpOutputFile
  });

  // Create job record in state
  const job = createJob({
    mode: 'task',
    prompt,
    sandbox,
    workspaceRoot: targetDir,
    model: model || 'default',
    effort: effort || null
  });

  if (resumeSessionId) {
    job.codex_session_id = resumeSessionId;
    updateJob(job.id, { codex_session_id: resumeSessionId });
  }

  // Snapshot git status before run to detect modified files
  const beforeFiles = write ? new Set(getGitStatus(targetDir)) : new Set();

  try {
    const execResult = await runCodexProcess({
      codexBin,
      args,
      dir: targetDir,
      prompt,
      outputFile: tmpOutputFile,
      onEvent
    });

    const sessionId = execResult.threadId || resumeSessionId;
    const afterFiles = write ? getGitStatus(targetDir) : [];
    const modifiedFiles = write
      ? afterFiles.filter(f => !beforeFiles.has(f))
      : [];

    let artifactPath = null;
    if (execResult.resultText) {
      artifactPath = saveArtifact(job.id, 'response.md', execResult.resultText);
    }

    // Clean up temporary output file
    try {
      if (fs.existsSync(tmpOutputFile)) {
        fs.unlinkSync(tmpOutputFile);
      }
    } catch {
      // ignore
    }

    const isSuccess = execResult.exitCode === 0;
    const updatedJob = updateJob(job.id, {
      status: isSuccess ? 'completed' : 'failed',
      exit_code: execResult.exitCode,
      codex_session_id: sessionId,
      tokens: execResult.usage,
      result_artifact: artifactPath,
      error: !isSuccess ? execResult.rawStderr.slice(0, 500) : null
    });

    return {
      job: updatedJob,
      sessionId,
      resultText: execResult.resultText,
      rawStderr: execResult.rawStderr,
      exitCode: execResult.exitCode,
      modifiedFiles,
      usage: execResult.usage,
      durationMs: execResult.durationMs
    };
  } catch (err) {
    updateJob(job.id, {
      status: 'failed',
      exit_code: 1,
      error: err.message
    });
    throw err;
  }
}

/**
 * Execute a code review with Codex.
 */
export async function executeReview({
  prompt = '',
  scope = 'auto',
  base = null,
  model = null,
  dir = process.cwd(),
  onEvent = null
}) {
  const targetDir = path.resolve(dir);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Directory does not exist: ${targetDir}`);
  }

  const codexBin = findCodexBin();
  if (!codexBin) {
    throw new Error('Codex CLI executable not found in PATH or standard installation directories.');
  }

  const { artifactsDir } = ensureStateDir();
  const tmpOutputFile = path.join(
    artifactsDir,
    `tmp-review-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  );

  const { args, sandbox } = buildCodexArgs({
    mode: 'review',
    write: false,
    reviewScope: scope,
    reviewBase: base,
    dir: targetDir,
    model,
    outputFile: tmpOutputFile
  });

  const job = createJob({
    mode: 'review',
    prompt: prompt || 'Code review',
    sandbox,
    workspaceRoot: targetDir,
    model: model || 'default'
  });

  try {
    const execResult = await runCodexProcess({
      codexBin,
      args,
      dir: targetDir,
      prompt: prompt || 'Provide a thorough code review identifying bugs, security risks, and optimization opportunities.',
      outputFile: tmpOutputFile,
      onEvent
    });

    let artifactPath = null;
    if (execResult.resultText) {
      artifactPath = saveArtifact(job.id, 'review.md', execResult.resultText);
    }

    try {
      if (fs.existsSync(tmpOutputFile)) {
        fs.unlinkSync(tmpOutputFile);
      }
    } catch {
      // ignore
    }

    const isSuccess = execResult.exitCode === 0;
    const updatedJob = updateJob(job.id, {
      status: isSuccess ? 'completed' : 'failed',
      exit_code: execResult.exitCode,
      codex_session_id: execResult.threadId,
      tokens: execResult.usage,
      result_artifact: artifactPath,
      error: !isSuccess ? execResult.rawStderr.slice(0, 500) : null
    });

    return {
      job: updatedJob,
      sessionId: execResult.threadId,
      resultText: execResult.resultText,
      rawStderr: execResult.rawStderr,
      exitCode: execResult.exitCode,
      modifiedFiles: [],
      usage: execResult.usage,
      durationMs: execResult.durationMs
    };
  } catch (err) {
    updateJob(job.id, {
      status: 'failed',
      exit_code: 1,
      error: err.message
    });
    throw err;
  }
}

/**
 * Check system environment and readiness for codex-rescue.
 */
export async function checkSetup() {
  const checks = [];

  // 1. Node.js version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split('.')[0], 10);
  if (major >= 18) {
    checks.push({
      name: 'Node.js Runtime',
      status: 'ok',
      message: `${nodeVer} (compatible >= 18)`
    });
  } else {
    checks.push({
      name: 'Node.js Runtime',
      status: 'fail',
      message: `${nodeVer} is unsupported; requires Node >= 18.0.0`
    });
  }

  // 2. Git binary
  try {
    const gitRes = spawnSync('git', ['--version'], { encoding: 'utf8', shell: false });
    if (gitRes.status === 0) {
      checks.push({
        name: 'Git Version Control',
        status: 'ok',
        message: gitRes.stdout.trim()
      });
    } else {
      checks.push({
        name: 'Git Version Control',
        status: 'warn',
        message: 'Git returned non-zero status.'
      });
    }
  } catch (err) {
    checks.push({
      name: 'Git Version Control',
      status: 'warn',
      message: `Git not found in PATH (${err.message}).`
    });
  }

  // 3. Codex binary
  const codexBin = findCodexBin();
  if (codexBin) {
    try {
      const verRes = spawnSync(codexBin, ['--version'], { encoding: 'utf8', shell: false });
      const verStr = verRes.status === 0 ? verRes.stdout.trim() : 'codex binary located';
      checks.push({
        name: 'Codex CLI Executable',
        status: 'ok',
        message: `${codexBin} (${verStr})`
      });
    } catch (err) {
      checks.push({
        name: 'Codex CLI Executable',
        status: 'fail',
        message: `Found at ${codexBin} but failed to execute: ${err.message}`
      });
    }
  } else {
    checks.push({
      name: 'Codex CLI Executable',
      status: 'fail',
      message: 'codex executable was not found in PATH or standard directories.'
    });
  }

  // 4. Codex Login Status
  if (codexBin) {
    try {
      const loginRes = spawnSync(codexBin, ['login', 'status'], {
        encoding: 'utf8',
        shell: false
      });
      const loginOut = (loginRes.stdout || '').trim() || (loginRes.stderr || '').trim();
      if (loginRes.status === 0) {
        checks.push({
          name: 'Codex Authentication',
          status: 'ok',
          message: loginOut || 'Authenticated'
        });
      } else {
        checks.push({
          name: 'Codex Authentication',
          status: 'warn',
          message: `Not authenticated or login error: ${loginOut || 'exit ' + loginRes.status}`
        });
      }
    } catch (err) {
      checks.push({
        name: 'Codex Authentication',
        status: 'warn',
        message: `Could not verify login: ${err.message}`
      });
    }
  }

  // 5. State directory permissions
  try {
    const { dir, artifactsDir } = ensureStateDir();
    const testFile = path.join(dir, `.test-write-${Date.now()}`);
    fs.writeFileSync(testFile, 'ok', 'utf8');
    fs.unlinkSync(testFile);
    checks.push({
      name: 'State Store Directory',
      status: 'ok',
      message: `Writable at ${dir}`
    });
  } catch (err) {
    checks.push({
      name: 'State Store Directory',
      status: 'fail',
      message: `Failed to write to state dir: ${err.message}`
    });
  }

  const ok = !checks.some(c => c.status === 'fail');
  return { ok, checks };
}
