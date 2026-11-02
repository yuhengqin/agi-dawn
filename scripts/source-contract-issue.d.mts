import type { SourceContractReport } from "./check-source-contracts.ts";

export function syncSourceContractIssue(input: {
  github: any;
  owner: string;
  repo: string;
  report: SourceContractReport;
  markdown: string;
}): Promise<{ action: string; hasCheckFailures: boolean }>;
