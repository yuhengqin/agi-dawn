// GitHub Script helper. Kept as plain JavaScript so the action can import it without a build step.
const MARKER = '<!-- agidawn-source-contract-drift:v1 -->';
const LABEL = 'source-contract-drift';
const TITLE = '复核信源列表契约';
const STATUSES = new Set(['unchanged', 'review-required', 'check-failed']);

function assertReport(report) {
  if (report?.version !== 1 || !STATUSES.has(report.status) || !Array.isArray(report.results)
    || !/^[a-f0-9]{64}$/.test(report.fingerprint ?? '')
    || report.results.some(result => !result || typeof result.id !== 'string' || !STATUSES.has(result.status))) {
    throw new Error('invalid-source-contract-report');
  }
}

/**
 * Synchronizes machine Issues only. A failed/incomplete check never closes one; matching fingerprints
 * preserve human edits and avoid weekly no-op updates. Returns whether the run itself should be failed.
 */
export async function syncSourceContractIssue({ github, owner, repo, report, markdown }) {
  assertReport(report);
  const hasCheckFailures = report.results.some(result => result.status === 'check-failed');
  if (report.status === 'check-failed') return { action: 'kept', hasCheckFailures: true };

  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner, repo, state: 'open', labels: LABEL, per_page: 100,
  });
  const machineIssues = issues.filter(issue => !issue.pull_request && issue.body?.includes(MARKER));

  if (report.status === 'unchanged') {
    for (const issue of machineIssues) {
      await github.rest.issues.update({ owner, repo, issue_number: issue.number, state: 'closed' });
    }
    return { action: machineIssues.length > 0 ? 'closed' : 'unchanged', hasCheckFailures: false };
  }

  const fingerprintMarker = `<!-- source-contract-fingerprint:${report.fingerprint} -->`;
  const body = MARKER + '\n' + fingerprintMarker + '\n' + markdown;
  const existing = machineIssues[0];
  let action = 'unchanged';
  if (existing) {
    if (!existing.body?.includes(fingerprintMarker)) {
      await github.rest.issues.update({ owner, repo, issue_number: existing.number, title: TITLE, body });
      action = 'updated';
    }
    for (const duplicate of machineIssues.slice(1)) {
      await github.rest.issues.update({ owner, repo, issue_number: duplicate.number, state: 'closed' });
    }
  } else {
    try {
      await github.rest.issues.getLabel({ owner, repo, name: LABEL });
    } catch (error) {
      if (error.status !== 404) throw error;
      await github.rest.issues.createLabel({
        owner, repo, name: LABEL, color: 'd876e3',
        description: 'Read-only public source listing contract drift',
      });
    }
    await github.rest.issues.create({ owner, repo, title: TITLE, body, labels: [LABEL] });
    action = 'created';
  }
  return { action, hasCheckFailures };
}
