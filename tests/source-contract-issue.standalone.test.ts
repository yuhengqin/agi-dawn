// Machine Issue lifecycle, with a mocked GitHub API and no repository or network access.
import assert from "node:assert/strict";
import { test } from "node:test";
import { syncSourceContractIssue } from "../scripts/source-contract-issue.mjs";
import type { SourceContractReport, SourceContractStatus } from "../scripts/check-source-contracts.ts";

const marker = "<!-- agidawn-source-contract-drift:v1 -->";
const fingerprint = (character: string) => character.repeat(64);
const report = (status: SourceContractStatus, id = fingerprint("a"), checkFailed = false): SourceContractReport => ({
  version: 1,
  checkedAt: "2026-11-01T00:00:00.000Z",
  status,
  fingerprint: id,
  results: [{ id: "source", name: "Source", kind: "rss", status: checkFailed ? "check-failed" : status, reason: "fixture", parsed: 0, admitted: 0, sampleUrls: [] }],
});

interface Issue { number: number; body?: string; pull_request?: boolean }
function mockGithub(issues: Issue[], labelMissing = false) {
  const calls: Array<{ method: string; args: Record<string, any> }> = [];
  const github = {
    paginate: async () => issues,
    rest: {
      issues: {
        listForRepo: async () => { throw new Error("paginate delegates in the action"); },
        update: async (args: Record<string, any>) => { calls.push({ method: "update", args }); return {}; },
        create: async (args: Record<string, any>) => { calls.push({ method: "create", args }); return {}; },
        getLabel: async (args: Record<string, any>) => {
          calls.push({ method: "getLabel", args });
          if (labelMissing) throw Object.assign(new Error("missing"), { status: 404 });
          return {};
        },
        createLabel: async (args: Record<string, any>) => { calls.push({ method: "createLabel", args }); return {}; },
      },
    },
  };
  return { github, calls };
}
const input = (github: any, value: SourceContractReport) => ({ github, owner: "owner", repo: "repo", report: value, markdown: "# Report\n" });

test("matching fingerprints preserve human edits and duplicate machine Issues are closed", async () => {
  const existing = { number: 10, body: `${marker}\n<!-- source-contract-fingerprint:${fingerprint("a")} -->\nhuman notes` };
  const duplicate = { number: 11, body: marker };
  const { github, calls } = mockGithub([existing, duplicate, { number: 12, body: "ordinary issue" }, { number: 13, body: marker, pull_request: true }]);
  const result = await syncSourceContractIssue(input(github, report("review-required")));
  assert.equal(result.action, "unchanged");
  assert.deepEqual(calls.map(call => [call.method, call.args.issue_number, call.args.state]), [["update", 11, "closed"]]);
  assert.match(existing.body, /human notes/);

  calls.length = 0;
  await syncSourceContractIssue(input(github, report("review-required", fingerprint("b"))));
  const update = calls.find(call => call.method === "update" && call.args.issue_number === 10);
  assert.ok(update);
  assert.match(update.args.body, new RegExp(fingerprint("b")));
  assert.equal(calls.some(call => call.method === "create"), false);
});

test("a new review creates the label when needed and retains mixed check-failure evidence", async () => {
  const { github, calls } = mockGithub([], true);
  const result = await syncSourceContractIssue(input(github, report("review-required", fingerprint("c"), true)));
  assert.equal(result.action, "created");
  assert.equal(result.hasCheckFailures, true);
  assert.deepEqual(calls.map(call => call.method), ["getLabel", "createLabel", "create"]);
  const created = calls.at(-1)!.args;
  assert.match(created.body, new RegExp(marker));
  assert.match(created.body, new RegExp(fingerprint("c")));
});

test("only a completely successful unchanged report closes machine Issues", async () => {
  const { github, calls } = mockGithub([
    { number: 20, body: marker },
    { number: 21, body: marker },
    { number: 22, body: "ordinary issue" },
    { number: 23, body: marker, pull_request: true },
  ]);
  const result = await syncSourceContractIssue(input(github, report("unchanged")));
  assert.equal(result.action, "closed");
  assert.deepEqual(calls.map(call => [call.args.issue_number, call.args.state]), [[20, "closed"], [21, "closed"]]);
});

test("check failures and malformed reports never call an Issue mutation", async () => {
  const { github, calls } = mockGithub([{ number: 30, body: marker }]);
  const failed = await syncSourceContractIssue(input(github, report("check-failed", fingerprint("d"), true)));
  assert.deepEqual(failed, { action: "kept", hasCheckFailures: true });
  await assert.rejects(syncSourceContractIssue(input(github, { ...report("unchanged"), fingerprint: "invalid" })), /invalid-source-contract-report/);
  assert.deepEqual(calls, []);
});
