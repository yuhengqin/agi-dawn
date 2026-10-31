// Admin API (/api/admin/*): what each back-office endpoint returns, shared by the api's admin
// functions and the admin pages. Only administrators reach it; it changes with the admin UI and is
// never a public contract. Rows mirror their SQL columns (snake_case); timestamps are ISO strings.

declare const iso: unique symbol;

/** An ISO 8601 time in a JSON body. The pages read it as a string; the api may produce it from a Date. */
export type Timestamp = string & { readonly [iso]: true };

/**
 * What the api may hand to JSON.stringify for a body of type T: a Date or an ISO string where the body
 * carries a Timestamp, everything else exactly as declared. Backend functions return `BeforeJson<AdminX>`;
 * the pages read `AdminX`.
 */
export type BeforeJson<T> = T extends Timestamp ? string | Date : T extends readonly (infer U)[] ? BeforeJson<U>[] : T extends object ? { [K in keyof T]: BeforeJson<T[K]> } : T;

export interface AdminMe {
  name: string;
  csrf: string;
  dev: boolean;
}

/** Items waiting for the admin, shown on the navigation: the engine's, and the modules' under their own keys. */
export type AdminNavCounts = Partial<Record<"feedback" | "sources" | "runs", number>> & Record<string, number | undefined>;

/** One manual change (audit_log), as a history list shows it. */
export interface AdminAuditEntry {
  created_at: Timestamp;
  actor: string;
  action: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

export interface AdminAuditRow extends AdminAuditEntry {
  id: number;
  subject: string | null;
}

export interface AdminAudit {
  page: number;
  rows: AdminAuditRow[];
}

// Sources

/** Ordinary collectors may replace one another while retaining a source's identity and history. */
export const REPLACEABLE_SOURCE_KINDS = ["rss", "web_list", "json_list"] as const;
export type ReplaceableSourceKind = typeof REPLACEABLE_SOURCE_KINDS[number];

export interface AdminSourceUpdate {
  patch: Partial<Pick<AdminSource, "name" | "enabled" | "interval_minutes" | "tier" | "participation_mode" | "first_party" | "site_fulltext" | "tags">> & (
    { kind?: never; config?: Record<string, unknown> } | { kind: ReplaceableSourceKind; config: Record<string, unknown> }
  );
  version: string;
  reason?: string;
}

export interface AdminSourceRow {
  id: string;
  name: string;
  kind: string;
  tier: string;
  participation_mode: string;
  enabled: boolean;
  health: string;
  fail_count: number;
  interval_minutes: number;
  last_ok_at: Timestamp | null;
  last_fetch_at: Timestamp | null;
  last_error: string | null;
  first_party: boolean;
  next_fetch_at: Timestamp | null;
  items_7d: number;
}

export interface AdminSources {
  page: number;
  rows: AdminSourceRow[];
  totals: { total: number; enabled: number; failing: number; degraded: number };
}

export interface AdminSource {
  id: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  tags: string[];
  first_party: boolean;
  tier: string;
  participation_mode: string;
  interval_minutes: number;
  site_fulltext: boolean;
  enabled: boolean;
  health: string;
  fail_count: number;
  last_fetch_at: Timestamp | null;
  last_ok_at: Timestamp | null;
  last_error: string | null;
  cursor: Record<string, unknown> | null;
  next_fetch_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AdminSourceDetail {
  source: AdminSource;
  runs: Array<{
    id: number; started_at: Timestamp; finished_at: Timestamp | null; status: string; found_count: number | null; new_count: number | null; error: string | null;
    detail: { pages?: number; backlog?: number; dropped?: number } | null;
  }>;
  items: Array<{ id: string; title: string; url: string; discovered_at: Timestamp; published_at: Timestamp | null; processing_state: string; visibility: string | null; public_title: string | null }>;
  stats: { total: number; last7d: number };
  history: AdminAuditEntry[];
  /** Progress of the re-derivation queued after the last change of licences, tier or participation. */
  republish: Record<string, unknown> | null;
}

/** Creating a source: refused as a duplicate of an existing one, or created. */
export type AdminSourceCreated =
  | { created: false; duplicate: { id: string; name: string } }
  | { created: true; source: AdminSource };

/** A fetch without storing: what a draft or an existing source would collect now. */
export interface AdminSourcePreview {
  ms: number;
  count: number;
  items: Array<{ title: string; url: string; publishedAt: Timestamp | null; excerpt: string }>;
}

// Content and events

export interface AdminContentRow {
  id: string;
  title: string;
  url: string;
  source: string;
  discovered_at: Timestamp;
  processing_state: string;
  visibility: string | null;
}

export interface AdminContentSearch {
  rows: AdminContentRow[];
}

/** The publications row of an item, as the publish step wrote it. */
export interface AdminPublication {
  article_id: string;
  revision: number;
  visibility: string;
  eligible: boolean;
  title: string;
  summary: string | null;
  category: string | null;
  tags: string[];
  source_id: string;
  channel: string;
  first_party: boolean;
  url: string;
  published_at: Timestamp | null;
  discovered_at: Timestamp;
  timeline_at: Timestamp;
  sort_at: Timestamp | null;
  backfill: boolean;
  body_mode: string;
  indexable: boolean;
  seo_indexed_at: Timestamp | null;
  seo_excluded_at: Timestamp | null;
  updated_at: Timestamp;
}

/** An item's whole chain: source → discoveries → revisions → judgements → publication → grouping → deliveries. */
export interface AdminContentChain {
  article: {
    id: string; source_id: string; url: string; identity_key: string; title: string; author: string | null; language: string | null;
    published_at: Timestamp | null; discovered_at: Timestamp;
    body_status: string; revision: number;body_revision:number|null;body_quality:string;body_issues:Array<{kind:string;message:string}>;body_refresh_requested_at:Timestamp|null; processing_state: string; processing_error: string | null;
    source_name: string; source_kind: string; site_fulltext: boolean;
  };
  discoveries: Array<{ source_id: string; via: string; discovered_at: Timestamp }>;
  revisions: Array<{ revision: number; title: string; content_hash: string | null; created_at: Timestamp }>;
  publication: AdminPublication | null;
  override: { fields: Record<string, unknown>; visibility: string | null; reason: string | null; version: number; updated_by: string; updated_at: Timestamp } | null;
  history: AdminAuditEntry[];
}

// Feedback

export interface AdminFeedbackRow {
  id: number;
  content: string;
  email: string | null;
  page_url: string | null;
  /** local (viewable here until forwarded), feishu (in the internal chat), gone (could not be forwarded), or null. */
  screenshot: "local" | "feishu" | "gone" | null;
  source_hash: string;
  status: string;
  note: string | null;
  forwarded_at: Timestamp | null;
  forward_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  banned: boolean;
  email_banned: boolean;
  from_source: number;
}

export interface AdminFeedback {
  page: number;
  rows: AdminFeedbackRow[];
  counts: Record<string, number>;
  bans: Array<{ source_hash: string; reason: string | null; created_by: string | null; created_at: Timestamp; expires_at: Timestamp | null }>;
}

// Runs

export interface AdminReceiptIssue {
  id: number;
  service: string;
  model: string | null;
  purpose: string;
  subject: string | null;
  status: string;
  attempts: number;
  error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AdminRuns {
  checkedAt: Timestamp;
  processes: Array<{ role: string; pid: number; host: string; release: string; startedAt: Timestamp; at: Timestamp; alive: boolean }>;
  jobs: Array<{ job: string; started_at: Timestamp; finished_at: Timestamp | null; status: string; error: string | null; failed_24h: number; runs_24h: number }>;
  timeline: Array<{ id: number; job: string; started_at: Timestamp; finished_at: Timestamp | null; status: string; error: string | null }>;
  queues: Array<{ name: string; state: string; n: number; oldest: Timestamp }>;
  failedJobs: Array<{ name: string; failed: number; last: Timestamp | null; last_output: string | null }>;
  lagging: Array<{
    id: string; name: string; kind: string; health: string; fail_count: number; last_ok_at: Timestamp | null; last_fetch_at: Timestamp | null;
    next_fetch_at: Timestamp | null; interval_minutes: number; last_error: string | null;
  }>;
  receipts: { counts: Record<string, number>; issues: AdminReceiptIssue[] };
  errors: Array<{ error: string; n: number; last: Timestamp; example: string }>;
  retrying: { count: number; next: Timestamp | null };
  ingest: Array<{ client: string; kind: string; status: string; error: string | null; summary: unknown; created_at: Timestamp }>;
  /** Each module's part of the page, under its name (what its server module's admin.runs returns). */
  modules: Record<string, unknown>;
}

// Settings

export interface AdminBudget {
  service: string;
  per_minute: number;
  per_hour: number;
  per_day: number;
  note: string | null;
  updated_at: Timestamp;
  used_day: number;
  used_hour: number;
}

export interface AdminSettings {
  contact: { wechatQr: string | null; feishuQr: string | null };
  budgets: AdminBudget[];
}

export interface AdminPrincipal {
  userId: number | null;
  name: string;
  csrf: string;
  dev: boolean;
}
