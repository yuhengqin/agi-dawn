// Read-only public listing probes. No .env loading, database, article extraction, paid provider or archive writes.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { admitListing } from "@agidawn/backend/sources/filters";
import { fetchJsonList } from "@agidawn/backend/sources/json-list";
import { fetchRss } from "@agidawn/backend/sources/rss";
import { unsupportedConfig } from "@agidawn/backend/sources/config-keys";
import { fetchWebList } from "@agidawn/backend/sources/web-list";
import { HttpStatusError } from "@agidawn/backend/lib/http-fetch";
import { FetchError, type Candidate, type SourceRow } from "@agidawn/backend/sources/types";

export type SourceContractStatus = "unchanged" | "review-required" | "check-failed";
export type ContractSource = Pick<SourceRow, "id" | "name" | "kind" | "config" | "participation_mode">;

export interface SourceContractResult {
  id: string;
  name: string;
  kind: SourceRow["kind"];
  status: SourceContractStatus;
  reason: string;
  parsed: number;
  admitted: number;
  sampleUrls: string[];
}

export interface SourceContractReport {
  version: 1;
  checkedAt: string;
  status: SourceContractStatus;
  fingerprint: string;
  results: SourceContractResult[];
}

type Probe = (source: SourceRow) => Promise<Candidate[]>;

async function probeListing(source: SourceRow): Promise<Candidate[]> {
  if (source.kind === "rss") return (await fetchRss(source, { force: true })).candidates;
  if (source.kind === "web_list") return fetchWebList(source);
  if (source.kind === "json_list") return fetchJsonList(source);
  throw new Error(`Unsupported source kind: ${source.kind}`);
}

function sourceRow(source: ContractSource): SourceRow {
  return {
    ...source,
    tier: "T1",
    first_party: false,
    interval_minutes: 0,
    enabled: false,
    cursor: null,
    fail_count: 0,
  };
}

/** The scheduled probe is deliberately narrower than the collector's private-feed and paid-rendering abilities. */
function configurationProblem(source: ContractSource): string | null {
  if (!["rss", "web_list", "json_list"].includes(source.kind)) return "unsupported-kind";
  const unsupported = unsupportedConfig(source.kind, source.config);
  if (unsupported.length > 0) return `unsupported-config:${unsupported.join(",").slice(0, 160)}`;
  if (source.config.fetchPublicContent === true) return "paid-rendering-not-allowed";
  if (source.config.headers !== undefined || source.config.bodyJson !== undefined) return "custom-request-data-not-allowed";
  if (String(source.config.method ?? "GET").toUpperCase() !== "GET") return "non-get-not-allowed";
  const value = source.kind === "rss" ? source.config.feedUrl : source.config.url;
  if (typeof value !== "string") return "listing-url-missing";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "public-https-url-required";
    if (["r.jina.ai", "api.github.com"].includes(url.hostname)) return "credentialed-or-paid-host-not-allowed";
  } catch {
    return "invalid-listing-url";
  }
  return null;
}

function networkReason(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error.name === "TimeoutError" || error.name === "AbortError") return "network-timeout";
  const code = (error as NodeJS.ErrnoException).code;
  if (code && /^[A-Z][A-Z0-9_]+$/.test(code)) return `network-${code.toLowerCase()}`;
  if (error.cause) {
    const reason = networkReason(error.cause);
    if (reason) return reason;
  }
  if (error instanceof AggregateError) {
    for (const cause of error.errors) {
      const reason = networkReason(cause);
      if (reason) return reason;
    }
  }
  return error.name === "TypeError" && error.message === "fetch failed" ? "network-request-failed" : null;
}

function reasonFor(error: unknown): { status: SourceContractStatus; reason: string } {
  if (error instanceof HttpStatusError) return { status: "check-failed", reason: `http-${error.status}` };
  if (error instanceof FetchError) {
    const reason = error.message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 240);
    return { status: "review-required", reason: reason || "parser-rejected" };
  }
  const network = networkReason(error);
  if (network) return { status: "check-failed", reason: network };
  const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9]+$/.test(error.name) ? error.name : "unknown";
  return { status: "check-failed", reason: `checker-error-${name.toLowerCase()}` };
}

async function checkOne(source: ContractSource, probe: Probe): Promise<SourceContractResult> {
  const base = { id: source.id, name: source.name, kind: source.kind, parsed: 0, admitted: 0, sampleUrls: [] };
  const problem = configurationProblem(source);
  if (problem) return { ...base, status: "check-failed", reason: problem };
  const row = sourceRow(source);
  try {
    const candidates = await probe(row);
    const admitted = admitListing(candidates, row);
    return {
      ...base,
      status: admitted.length > 0 ? "unchanged" : "review-required",
      reason: admitted.length > 0 ? "listing-readable" : "no-items-after-parsing-and-filters",
      parsed: candidates.length,
      admitted: admitted.length,
      sampleUrls: (admitted.length > 0 ? admitted : candidates).slice(0, 3).map(candidate => candidate.url),
    };
  } catch (error) {
    return { ...base, ...reasonFor(error) };
  }
}

export async function checkSourceContracts(
  sources: ContractSource[],
  options: { probe?: Probe; now?: Date } = {},
): Promise<SourceContractReport> {
  const probe = options.probe ?? probeListing;
  const results: SourceContractResult[] = [];
  // Small batches avoid competing with publishers more than the ordinary collector does.
  for (let offset = 0; offset < sources.length; offset += 4) {
    results.push(...await Promise.all(sources.slice(offset, offset + 4).map(source => checkOne(source, probe))));
  }
  results.sort((a, b) => a.id.localeCompare(b.id));
  const status: SourceContractStatus = results.some(result => result.status === "review-required") ? "review-required"
    : results.some(result => result.status === "check-failed") ? "check-failed" : "unchanged";
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(results.map(({ id, status, reason }) => ({ id, status, reason }))))
    .digest("hex");
  return { version: 1, checkedAt: (options.now ?? new Date()).toISOString(), status, fingerprint, results };
}

const cell = (value: string | number) => String(value).replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|");
const statusText: Record<SourceContractStatus, string> = {
  unchanged: "列表契约可读",
  "review-required": "需要人工复核",
  "check-failed": "检查未完成",
};

export function renderSourceContractReport(report: SourceContractReport): string {
  const lines = [
    "# 信源列表契约复核",
    "",
    `状态：${statusText[report.status]}。检查时间：${report.checkedAt}。`,
    "",
    "这是对 `industry/sources.json` 初始化模板的只读公开列表检查，不读取运行时数据库。复用当前 RSS、HTML 和 JSON 解析器及列表筛选；不提取正文、不调用付费服务、不修改来源配置。",
    "解析或筛选没有结果是复核信号，不直接证明上游已经损坏；网络、HTTP 或检查器错误属于检查未完成，不能据此关闭已有问题。",
    "",
    "| 信源 | 类型 | 结果 | 解析条数 | 通过筛选 | 原因 |",
    "| --- | --- | --- | ---: | ---: | --- |",
  ];
  for (const result of report.results) {
    lines.push(`| ${cell(result.name)} (\`${cell(result.id)}\`) | ${cell(result.kind)} | ${statusText[result.status]} | ${result.parsed} | ${result.admitted} | ${cell(result.reason)} |`);
  }
  for (const result of report.results.filter(result => result.sampleUrls.length > 0)) {
    lines.push("", `## ${cell(result.name)} 样本`, "");
    for (const url of result.sampleUrls) lines.push(`- <${url.replace(/>/g, "%3E")}>`);
  }
  lines.push("", "人工对照原站并修复后，下一次全部成功的 `unchanged` 报告会关闭机器 Issue。指纹相同不重复更新 Issue。", "", `指纹：\`${report.fingerprint}\``, "");
  return lines.join("\n");
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const output = option(args, "--output"), markdown = option(args, "--markdown");
  if (!output || !markdown) throw new Error("usage: node scripts/check-source-contracts.ts --output report.json --markdown report.md");
  const template = JSON.parse(await readFile(new URL("../industry/sources.json", import.meta.url), "utf8")) as { sources?: ContractSource[] };
  if (!Array.isArray(template.sources)) throw new Error("industry/sources.json has no sources array");
  const report = await checkSourceContracts(template.sources);
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await mkdir(path.dirname(path.resolve(markdown)), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  await writeFile(markdown, renderSourceContractReport(report));
  console.log(`Source contracts: ${report.status}; report: ${output}`);
  process.exitCode = report.status === "check-failed" ? 1 : report.status === "review-required" ? 2 : 0;
}

if (import.meta.main) main().catch(error => {
  console.error(`Source contract check could not produce a report: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
