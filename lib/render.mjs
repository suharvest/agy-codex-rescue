/**
 * Output rendering and log filtering for codex-rescue.
 */

/**
 * Filter out noisy internal Rust tracing lines from stderr while preserving genuine errors.
 */
export function cleanStderr(rawStderr) {
  if (!rawStderr) return '';
  const lines = rawStderr.split(/\r?\n/);
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    // Filter Rust tracing logs from codex internal subsystems
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s+codex_models_manager::/.test(trimmed)) {
      return false;
    }
    // Filter reading from stdin banner
    if (/^Reading additional input from stdin\.\.\./.test(trimmed)) {
      return false;
    }
    // Filter git default branch hint noise if run inside newly initialized repo
    if (/^hint:/.test(trimmed)) {
      return false;
    }

    return true;
  });

  return filtered.join('\n').trim();
}

/**
 * Format execution verdict from result text and exit status.
 */
export function extractVerdict(resultText, exitCode, rawStderr) {
  if (exitCode !== 0) {
    const cleanedErr = cleanStderr(rawStderr);
    if (cleanedErr) {
      const firstLine = cleanedErr.split('\n')[0].slice(0, 150);
      return `Execution failed with exit code ${exitCode}: ${firstLine}`;
    }
    return `Execution terminated with non-zero exit code (${exitCode}).`;
  }

  if (!resultText || !resultText.trim()) {
    return 'Execution completed without returning text.';
  }

  // Look for a summary or conclusion paragraph
  const paragraphs = resultText
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return 'Analysis completed.';
  }

  // Check if first paragraph is a short summary (< 250 chars)
  const first = paragraphs[0];
  if (first.length <= 250 && !first.startsWith('```') && !first.startsWith('#')) {
    return first;
  }

  // Check if there is an explicit summary or verdict header in markdown
  const verdictMatch = resultText.match(/(?:###?|\*\*)\s*(?:Verdict|Summary|Conclusion|Takeaway)\s*(?:###?|\*\*|\:)?\s*([^\n]+)/i);
  if (verdictMatch && verdictMatch[1]) {
    return verdictMatch[1].trim();
  }

  return 'Analysis completed successfully. See detailed findings below.';
}

/**
 * Format markdown report for agent chat context or terminal consumption.
 */
export function formatMarkdownReport({
  job,
  prompt = '',
  resultText = '',
  rawStderr = '',
  exitCode = 0,
  modifiedFiles = [],
  usage = null,
  durationMs = null
}) {
  const isSuccess = exitCode === 0;
  const statusBadge = isSuccess ? '✅ **Success**' : `❌ **Failed (Exit Code ${exitCode})**`;
  const durationSec = durationMs ? (durationMs / 1000).toFixed(2) + 's' : 'N/A';

  const sections = [];

  // 1. Execution Summary
  sections.push(`## 🛡️ Codex Rescue Execution Summary

- **Status**: ${statusBadge}
- **Job ID**: \`${job.id}\`
- **Session ID**: ${job.codex_session_id ? `\`${job.codex_session_id}\`` : '*Not assigned*'}
- **Mode / Sandbox**: \`${job.mode}\` / \`${job.sandbox}\`
- **Workspace Root**: \`${job.workspace_root}\`
- **Duration**: ${durationSec}${usage ? `\n- **Token Usage**: ${usage.input_tokens ?? 0} in / ${usage.output_tokens ?? 0} out (total: ${(usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)})` : ''}`);

  // 2. Verdict
  const verdict = extractVerdict(resultText, exitCode, rawStderr);
  sections.push(`## 📋 Verdict

${verdict}`);

  // 3. Genuine Errors (if any)
  const cleanedErr = cleanStderr(rawStderr);
  if (cleanedErr && (!isSuccess || cleanedErr.toLowerCase().includes('error'))) {
    sections.push(`## ⚠️ Execution Warnings & Stderr

\`\`\`text
${cleanedErr}
\`\`\``);
  }

  // 4. Findings & Analysis
  sections.push(`## 🔍 Findings & Analysis

${resultText.trim() ? resultText.trim() : '*No response body returned from model.*'}`);

  // 5. Modified Files
  sections.push(`## 📝 Modified Files`);
  if (job.sandbox === 'read-only') {
    sections.push('*No files modified (strict read-only sandbox enforced).*');
  } else if (modifiedFiles && modifiedFiles.length > 0) {
    const fileList = modifiedFiles.map(f => `- \`${f}\``).join('\n');
    sections.push(`${fileList}`);
  } else {
    sections.push('*No workspace files were modified during this execution.*');
  }

  // 6. Next Steps
  sections.push(`## 🚀 Next Steps`);
  const resumeId = job.id;
  if (isSuccess) {
    if (job.sandbox === 'workspace-write') {
      sections.push(`- **Review changes**: Check working tree with \`git status\` or \`git diff\`.
- **Run verification**: Run test suite before committing changes.
- **Continue discussion**: Resume session with:
  \`\`\`bash
  codex-rescue task "<followup instructions>" --resume ${resumeId}
  \`\`\``);
    } else {
      sections.push(`- **Apply fixes**: If you want Codex to write changes, execute with \`--write\`:
  \`\`\`bash
  codex-rescue task "Apply the recommended fix" --write --resume ${resumeId}
  \`\`\`
- **Ask follow-up questions**:
  \`\`\`bash
  codex-rescue task "<question>" --resume ${resumeId}
  \`\`\``);
    }
  } else {
    sections.push(`- **Retry**: Re-run the task with fresh state or check \`codex-rescue setup\`.
- **Diagnose**: Run \`codex login status\` or \`codex-rescue status ${resumeId}\`.`);
  }

  return sections.join('\n\n') + '\n';
}

/**
 * Render job status table/summary.
 */
export function formatJobStatus(job) {
  if (!job) return 'No job found.';
  return `Job Status:
  ID:             ${job.id}
  Codex Session:  ${job.codex_session_id || 'N/A'}
  Status:         ${job.status} (exit ${job.exit_code ?? 'running'})
  Mode:           ${job.mode}
  Sandbox:        ${job.sandbox}
  Model:          ${job.model}
  Workspace:      ${job.workspace_root}
  Created At:     ${job.created_at}
  Updated At:     ${job.updated_at}
  Prompt:         ${job.prompt_preview || 'N/A'}
  Artifact:       ${job.result_artifact || 'None'}`;
}

/**
 * Format job list as ASCII table.
 */
export function formatJobList(jobs) {
  if (!jobs || jobs.length === 0) {
    return 'No saved jobs recorded.';
  }

  const header = [
    'JOB ID'.padEnd(25),
    'STATUS'.padEnd(10),
    'SANDBOX'.padEnd(16),
    'MODE'.padEnd(8),
    'CREATED'.padEnd(22),
    'WORKSPACE'
  ].join(' | ');

  const separator = '-'.repeat(header.length + 10);
  const rows = jobs.map(j => {
    const id = j.id.padEnd(25);
    const status = (j.status || 'unknown').padEnd(10);
    const sandbox = (j.sandbox || 'read-only').padEnd(16);
    const mode = (j.mode || 'task').padEnd(8);
    const created = (j.created_at || '').slice(0, 19).replace('T', ' ').padEnd(22);
    const ws = j.workspace_root || '';
    return `${id} | ${status} | ${sandbox} | ${mode} | ${created} | ${ws}`;
  });

  return [header, separator, ...rows].join('\n');
}

/**
 * Format setup health check report.
 */
export function formatSetupReport(report) {
  const lines = [
    '=====================================',
    ' 🛡️  CODEX-RESCUE ENVIRONMENT SETUP  ',
    '====================================='
  ];

  let allOk = true;
  for (const check of report.checks) {
    const badge = check.status === 'ok' ? ' [PASS] ' : check.status === 'warn' ? ' [WARN] ' : ' [FAIL] ';
    if (check.status === 'fail') allOk = false;
    lines.push(`${badge.padEnd(8)} ${check.name}: ${check.message}`);
  }

  lines.push('-------------------------------------');
  if (allOk) {
    lines.push('Result: Ready to use! Codex rescue bridge is properly configured.');
  } else {
    lines.push('Result: Issues detected. Please resolve failed checks before running.');
  }
  lines.push('=====================================');

  return lines.join('\n');
}
