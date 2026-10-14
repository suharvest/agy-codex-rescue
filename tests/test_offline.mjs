import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  getStateDir,
  ensureStateDir,
  loadState,
  saveState,
  createJob,
  updateJob,
  getJob,
  listJobs,
  getLatestJob,
  resolveResumeSession
} from '../lib/state.mjs';

import {
  cleanStderr,
  extractVerdict,
  formatMarkdownReport,
  formatJobStatus,
  formatJobList,
  formatSetupReport
} from '../lib/render.mjs';

import {
  buildCodexArgs,
  checkSetup
} from '../lib/engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '..', 'bin', 'codex-rescue');

// ==========================================
// TEST SUITE 1: Sandbox Enforcement & Codex Args
// ==========================================
test('Sandbox enforcement - defaults to read-only', () => {
  const { args, sandbox } = buildCodexArgs({
    mode: 'task',
    write: false,
    dir: '/tmp/test-workspace'
  });

  assert.equal(sandbox, 'read-only');
  assert.ok(args.includes('-s'));
  assert.equal(args[args.indexOf('-s') + 1], 'read-only');
  assert.ok(args.includes('-a'));
  assert.equal(args[args.indexOf('-a') + 1], 'never');
  assert.ok(!args.includes('danger-full-access'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('Sandbox enforcement - workspace-write only when write=true', () => {
  const { args, sandbox } = buildCodexArgs({
    mode: 'task',
    write: true,
    dir: '/tmp/test-workspace'
  });

  assert.equal(sandbox, 'workspace-write');
  assert.ok(args.includes('-s'));
  assert.equal(args[args.indexOf('-s') + 1], 'workspace-write');
  assert.ok(args.includes('-a'));
  assert.equal(args[args.indexOf('-a') + 1], 'never');
  assert.ok(!args.includes('danger-full-access'));
});

test('Sandbox enforcement - review subcommand is always read-only', () => {
  const { args, sandbox } = buildCodexArgs({
    mode: 'review',
    scope: 'working-tree',
    dir: '/tmp/test-workspace'
  });

  assert.equal(sandbox, 'read-only');
  assert.equal(args[args.indexOf('-s') + 1], 'read-only');
  assert.ok(args.includes('review'));
});

test('Codex args - resume session formatting', () => {
  const { args } = buildCodexArgs({
    mode: 'task',
    resumeSessionId: 'sess-12345-uuid',
    outputFile: '/tmp/out.txt'
  });

  assert.ok(args.includes('exec'));
  assert.ok(args.includes('resume'));
  assert.ok(args.includes('sess-12345-uuid'));
  assert.ok(args.includes('-o'));
  assert.equal(args[args.indexOf('-o') + 1], '/tmp/out.txt');
  assert.equal(args[args.length - 1], '-'); // prompt via stdin
});

test('Codex args - model and effort flags forwarded', () => {
  const { args } = buildCodexArgs({
    mode: 'task',
    model: 'o3-mini',
    effort: 'high'
  });

  assert.ok(args.includes('-m'));
  assert.equal(args[args.indexOf('-m') + 1], 'o3-mini');
  assert.ok(args.includes('-c'));
  assert.ok(args.some(a => a.includes('model_reasoning_effort="high"')));
});

// ==========================================
// TEST SUITE 2: State Persistence & Atomic Writes
// ==========================================
test('State store - atomic operations and job lifecycle', (t) => {
  const tmpStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-state-'));
  const origEnv = process.env.AGY_CODEX_STATE_DIR;
  process.env.AGY_CODEX_STATE_DIR = tmpStateDir;

  t.after(() => {
    if (origEnv !== undefined) {
      process.env.AGY_CODEX_STATE_DIR = origEnv;
    } else {
      delete process.env.AGY_CODEX_STATE_DIR;
    }
    fs.rmSync(tmpStateDir, { recursive: true, force: true });
  });

  // Verify initial state is empty
  const initial = loadState();
  assert.deepEqual(initial.jobs, []);

  // Create job
  const job = createJob({
    mode: 'task',
    prompt: 'Check memory leaks in parser',
    sandbox: 'read-only',
    workspaceRoot: '/tmp/sample-workspace'
  });

  assert.ok(job.id.startsWith('job-'));
  assert.equal(job.status, 'running');
  assert.equal(job.sandbox, 'read-only');

  // Verify persisted
  const reloaded = loadState();
  assert.equal(reloaded.jobs.length, 1);
  assert.equal(reloaded.jobs[0].id, job.id);

  // Update job
  const updated = updateJob(job.id, {
    status: 'completed',
    exit_code: 0,
    codex_session_id: 'session-uuid-999'
  });
  assert.equal(updated.status, 'completed');
  assert.equal(updated.codex_session_id, 'session-uuid-999');

  // Lookup by ID
  const found = getJob(job.id);
  assert.equal(found.id, job.id);
  assert.equal(found.codex_session_id, 'session-uuid-999');

  // Lookup by session ID
  const foundBySession = getJob('session-uuid-999');
  assert.equal(foundBySession.id, job.id);

  // Latest job for workspace
  const latest = getLatestJob('/tmp/sample-workspace');
  assert.equal(latest.id, job.id);

  const nonExistent = getLatestJob('/tmp/other-workspace');
  assert.equal(nonExistent, null);
});

// ==========================================
// TEST SUITE 3: Resume Validation & Fail-Closed Logic
// ==========================================
test('Resume validation - fail closed if session missing or ambiguous', (t) => {
  const tmpStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-resume-'));
  const origEnv = process.env.AGY_CODEX_STATE_DIR;
  process.env.AGY_CODEX_STATE_DIR = tmpStateDir;

  t.after(() => {
    if (origEnv !== undefined) {
      process.env.AGY_CODEX_STATE_DIR = origEnv;
    } else {
      delete process.env.AGY_CODEX_STATE_DIR;
    }
    fs.rmSync(tmpStateDir, { recursive: true, force: true });
  });

  // 1. Non-existent explicit job ID throws clear error
  assert.throws(
    () => resolveResumeSession('job-nonexistent-123', '/tmp/workspace'),
    /Resume error: Job or session 'job-nonexistent-123' was not found in state store/
  );

  // 2. Empty workspace with no previous sessions throws clear error
  assert.throws(
    () => resolveResumeSession(null, '/tmp/empty-workspace'),
    /Resume error: No previous Codex session found for workspace/
  );

  // 3. Job exists but has no codex_session_id
  const jobNoSession = createJob({
    mode: 'task',
    prompt: 'Dummy',
    workspaceRoot: '/tmp/no-sess'
  });
  assert.throws(
    () => resolveResumeSession(jobNoSession.id, '/tmp/no-sess'),
    /has no recorded Codex session ID/
  );

  // 4. Valid session resolves correctly
  updateJob(jobNoSession.id, { codex_session_id: 'sess-valid-456' });
  const resolved = resolveResumeSession(null, '/tmp/no-sess');
  assert.equal(resolved.sessionId, 'sess-valid-456');
  assert.equal(resolved.job.id, jobNoSession.id);
});

// ==========================================
// TEST SUITE 4: Markdown Rendering & Log Filtering
// ==========================================
test('Log filtering - cleanStderr removes Rust tracing noise but keeps real errors', () => {
  const noisyStderr = [
    '2026-10-14T14:06:40.295878Z ERROR codex_models_manager::manager: failed to refresh available models: request timed out',
    '2026-10-14T14:06:40.307921Z ERROR codex_models_manager::manager: failed to refresh available models: request timed out',
    'Reading additional input from stdin...',
    'hint: Using master as initial branch',
    'FATAL: Unauthorized API key provided',
    'SyntaxError: Unexpected token'
  ].join('\n');

  const cleaned = cleanStderr(noisyStderr);
  assert.ok(!cleaned.includes('codex_models_manager'));
  assert.ok(!cleaned.includes('Reading additional input'));
  assert.ok(!cleaned.includes('hint: Using master'));
  assert.ok(cleaned.includes('FATAL: Unauthorized API key provided'));
  assert.ok(cleaned.includes('SyntaxError: Unexpected token'));
});

test('Markdown report formatting - sections and badge generation', () => {
  const sampleJob = {
    id: 'job-20261014-abc',
    codex_session_id: '01a13abc-8328-7593-ae06-3e7800f2ed32',
    mode: 'task',
    sandbox: 'read-only',
    workspace_root: '/home/harvest/project/test-repo'
  };

  const report = formatMarkdownReport({
    job: sampleJob,
    prompt: 'Investigate leak in connection pool',
    resultText: 'The leak is located in connection_pool.py:45 where sockets are not closed.',
    rawStderr: '',
    exitCode: 0,
    modifiedFiles: [],
    usage: { input_tokens: 1500, output_tokens: 120 },
    durationMs: 3450
  });

  assert.ok(report.includes('## 🛡️ Codex Rescue Execution Summary'));
  assert.ok(report.includes('✅ **Success**'));
  assert.ok(report.includes('`job-20261014-abc`'));
  assert.ok(report.includes('`01a13abc-8328-7593-ae06-3e7800f2ed32`'));
  assert.ok(report.includes('`read-only`'));
  assert.ok(report.includes('## 📋 Verdict'));
  assert.ok(report.includes('## 🔍 Findings & Analysis'));
  assert.ok(report.includes('connection_pool.py:45'));
  assert.ok(report.includes('## 📝 Modified Files'));
  assert.ok(report.includes('*No files modified (strict read-only sandbox enforced).*'));
  assert.ok(report.includes('## 🚀 Next Steps'));
  assert.ok(report.includes('--resume job-20261014-abc'));
});

test('Markdown report formatting - workspace-write modified files list', () => {
  const sampleJob = {
    id: 'job-20261014-write',
    codex_session_id: 'sess-xyz',
    mode: 'task',
    sandbox: 'workspace-write',
    workspace_root: '/home/harvest/project/test-repo'
  };

  const report = formatMarkdownReport({
    job: sampleJob,
    prompt: 'Fix the bug',
    resultText: 'Patched file.',
    exitCode: 0,
    modifiedFiles: ['src/connection.py', 'tests/test_conn.py']
  });

  assert.ok(report.includes('`src/connection.py`'));
  assert.ok(report.includes('`tests/test_conn.py`'));
});

// ==========================================
// TEST SUITE 5: CLI Invocation & Flag Handling
// ==========================================
test('CLI dry-run - help and version', () => {
  const helpRes = spawnSync(CLI_PATH, ['--help'], { encoding: 'utf8' });
  assert.equal(helpRes.status, 0);
  assert.ok(helpRes.stdout.includes('codex-rescue v'));
  assert.ok(helpRes.stdout.includes('COMMANDS:'));

  const verRes = spawnSync(CLI_PATH, ['--version'], { encoding: 'utf8' });
  assert.equal(verRes.status, 0);
  assert.ok(verRes.stdout.includes('codex-rescue v1.0.0'));
});

test('CLI validation - missing prompt exits with code 2', () => {
  const res = spawnSync(CLI_PATH, ['task'], {
    encoding: 'utf8',
    input: ''
  });
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes('Error: No prompt provided'));
});

test('CLI validation - unknown flag exits with code 2', () => {
  const res = spawnSync(CLI_PATH, ['task', 'hello', '--unrecognized-flag'], {
    encoding: 'utf8'
  });
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes('Error: Unknown flag'));
});

test('CLI validation - setup command runs and returns exit code 0 or 1', () => {
  const res = spawnSync(CLI_PATH, ['setup', '--json'], { encoding: 'utf8' });
  // If setup succeeds, exit code is 0; if missing optional things, 1
  assert.ok(res.status === 0 || res.status === 1);
  const data = JSON.parse(res.stdout);
  assert.ok(Array.isArray(data.checks));
  assert.ok(data.checks.some(c => c.name === 'Node.js Runtime' && c.status === 'ok'));
});
