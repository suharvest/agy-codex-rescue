import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Get the base directory for state storage.
 * Honors AGY_CODEX_STATE_DIR or XDG_CONFIG_HOME.
 */
export function getStateDir() {
  if (process.env.AGY_CODEX_STATE_DIR) {
    return path.resolve(process.env.AGY_CODEX_STATE_DIR);
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'agy-codex-rescue');
}

/**
 * Ensure state directory exists.
 */
export function ensureStateDir() {
  const dir = getStateDir();
  const artifactsDir = path.join(dir, 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true, mode: 0o700 });
  }
  return { dir, artifactsDir };
}

/**
 * Load the state object from jobs.json.
 */
export function loadState() {
  const { dir } = ensureStateDir();
  const jobsFile = path.join(dir, 'jobs.json');

  if (!fs.existsSync(jobsFile)) {
    return { version: 1, jobs: [] };
  }

  try {
    const raw = fs.readFileSync(jobsFile, 'utf8');
    if (!raw.trim()) {
      return { version: 1, jobs: [] };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.jobs)) {
      return { version: 1, jobs: [] };
    }
    return parsed;
  } catch (err) {
    // Corrupted state file: preserve backup and reset
    try {
      const backupPath = path.join(dir, `jobs.json.corrupt.${Date.now()}`);
      fs.copyFileSync(jobsFile, backupPath);
    } catch {
      // ignore backup copy error
    }
    return { version: 1, jobs: [] };
  }
}

/**
 * Atomically save the state object to jobs.json.
 */
export function saveState(state) {
  const { dir } = ensureStateDir();
  const jobsFile = path.join(dir, 'jobs.json');
  const tempFile = path.join(
    dir,
    `.jobs.json.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );

  const payload = JSON.stringify(state, null, 2) + '\n';
  fs.writeFileSync(tempFile, payload, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempFile, jobsFile);
}

/**
 * Generate a unique job ID.
 */
export function generateJobId() {
  const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(3).toString('hex');
  return `job-${dateStr}-${rand}`;
}

/**
 * Create and persist a new job record.
 */
export function createJob({
  mode = 'task',
  prompt = '',
  sandbox = 'read-only',
  workspaceRoot = process.cwd(),
  model = 'default',
  effort = null
}) {
  const state = loadState();
  const id = generateJobId();
  const now = new Date().toISOString();

  const job = {
    id,
    codex_session_id: null,
    mode,
    sandbox,
    workspace_root: path.resolve(workspaceRoot),
    model: model || 'default',
    effort: effort || null,
    prompt_preview: prompt ? prompt.slice(0, 200).replace(/\r?\n/g, ' ') : '',
    status: 'running',
    exit_code: null,
    created_at: now,
    updated_at: now,
    tokens: null,
    result_artifact: null,
    error: null
  };

  state.jobs.unshift(job);
  // Keep max 200 recent jobs
  if (state.jobs.length > 200) {
    state.jobs = state.jobs.slice(0, 200);
  }

  saveState(state);
  return job;
}

/**
 * Update an existing job by ID.
 */
export function updateJob(jobId, updates = {}) {
  const state = loadState();
  const idx = state.jobs.findIndex(j => j.id === jobId);
  if (idx === -1) {
    return null;
  }

  const updated = {
    ...state.jobs[idx],
    ...updates,
    updated_at: new Date().toISOString()
  };

  state.jobs[idx] = updated;
  saveState(state);
  return updated;
}

/**
 * Get job by ID or Codex Session ID.
 */
export function getJob(identifier) {
  if (!identifier) return null;
  const state = loadState();
  return (
    state.jobs.find(
      j => j.id === identifier || j.codex_session_id === identifier
    ) || null
  );
}

/**
 * List jobs, optionally filtered by workspace root.
 */
export function listJobs(limit = 20, workspaceRoot = null) {
  const state = loadState();
  let list = state.jobs;
  if (workspaceRoot) {
    const targetRoot = path.resolve(workspaceRoot);
    list = list.filter(j => j.workspace_root === targetRoot);
  }
  return list.slice(0, limit);
}

/**
 * Get the latest job for a workspace (or overall if workspace is null).
 */
export function getLatestJob(workspaceRoot = null) {
  const jobs = listJobs(1, workspaceRoot);
  return jobs.length > 0 ? jobs[0] : null;
}

/**
 * Save an artifact file for a job.
 */
export function saveArtifact(jobId, filename, content) {
  const { artifactsDir } = ensureStateDir();
  const safeFilename = `${jobId}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const targetPath = path.join(artifactsDir, safeFilename);
  fs.writeFileSync(targetPath, content, 'utf8');
  return targetPath;
}

/**
 * Resolve session ID for `--resume`.
 * Throws explicit descriptive error if cannot be found.
 */
export function resolveResumeSession(jobIdOrNull, workspaceRoot) {
  const resolvedRoot = path.resolve(workspaceRoot || process.cwd());

  if (jobIdOrNull && typeof jobIdOrNull === 'string' && jobIdOrNull.trim() !== '') {
    const query = jobIdOrNull.trim();
    const job = getJob(query);
    if (!job) {
      throw new Error(`Resume error: Job or session '${query}' was not found in state store.`);
    }
    if (!job.codex_session_id) {
      throw new Error(
        `Resume error: Job '${job.id}' exists but has no recorded Codex session ID to resume.`
      );
    }
    return { job, sessionId: job.codex_session_id };
  }

  // Look up latest job in the workspace
  const latest = getLatestJob(resolvedRoot);
  if (!latest) {
    throw new Error(
      `Resume error: No previous Codex session found for workspace '${resolvedRoot}'. Run a task first or specify an explicit job ID.`
    );
  }
  if (!latest.codex_session_id) {
    throw new Error(
      `Resume error: Latest job '${latest.id}' for workspace '${resolvedRoot}' has no recorded Codex session ID.`
    );
  }

  return { job: latest, sessionId: latest.codex_session_id };
}
