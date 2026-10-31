import type { BodyIssue,OutlineEntry } from "@agidawn/contracts/site";

export interface ReaderState {
  articleId: string;
  starred: boolean;
  status: "to-read" | "reading" | "read";
  updatedAt: string | null;
  version: number;
}
export interface ReaderNote {
  articleId: string;
  text: string;
  updatedAt: string | null;
  version: number;
}
export interface ReaderStatePatch { expectedVersion: number; starred?: boolean; status?: ReaderState["status"] }
export interface BulkReaderStatePatch { articles:Array<{id:string;expectedVersion:number}>;starred?:boolean;status?:ReaderState["status"] }
export interface BulkReaderStateResult { selected:number;changed:number }
export interface ReaderNotePatch { expectedVersion: number; text: string }
export interface ReaderPosition {snapshotId:string;bodyRevision:number;anchor:string|null;offset:number;progress:number;version:number;updatedAt:string}
export interface ReaderPositionRecord {position:ReaderPosition|null;previous:ReaderPosition|null}

export interface ClassifiedArticle {
  id:string;title:string;category:string|null;classificationVersion:number;topicSlugs:string[];
}
export interface LibraryFilters {
  sources:Array<{id:string;name:string}>;
  categories:Array<{id:string;name:string}>;
  topics:Array<{slug:string;name:string;definition:string}>;
}
export interface ReaderViewQuery {q?:string;sourceId?:string;category?:string;topic?:string;starred?:"true"|"false";status?:ReaderState["status"];hasNote?:"true"|"false";sort?:"collected"|"note-updated";dateField?:"collected"|"note-updated";dateFrom?:string;dateTo?:string}
export const readerViewQueryKeys=["q","sourceId","category","topic","starred","status","hasNote","sort","dateField","dateFrom","dateTo"] as const;
export interface SavedReaderView {id:string;name:string;filters:ReaderViewQuery;version:number;createdAt:string;updatedAt:string}
export interface ReaderLibrary {
  items:Array<{id:string;title:string;source:string;withdrawn:boolean;classificationVersion:number;state:ReaderState;note:{snippet:string;updatedAt:string}|null;matches:LibraryMatch[]}>;
  nextCursor:string|null;filters:LibraryFilters;
}
export interface BulkClassificationPatch {
  articles:Array<{id:string;expectedVersion:number}>;category?:string|null;addTopicSlugs:string[];removeTopicSlugs:string[];
}
export interface BulkClassificationResult {selected:number;changed:number}
export interface ManagedTopic {slug:string;name:string;definition:string;version:number;articleCount:number}
export interface LibraryMatch {field:"title"|"summary"|"body"|"note";snippet:string}

export interface ArchiveLimits {
  maxAssetBytes: number; maxSnapshotBytes: number; maxAssetsPerSnapshot: number; downloadConcurrency: number; timeoutMs: number;
}
export interface ArchiveSnapshot {
  id: string; articleId: string; bodyRevision: number; representationHash: string;
  title: string; author: string | null; originalUrl: string; publishedAt: string | null; discoveredAt: string;
  sourceId: string; sourceName: string; bodyHtml: string; quality: "ready" | "partial"; issues: BodyIssue[];
  createdAt: string; completedAt: string | null; formatVersion: number; status: "pending" | "partial" | "complete";
}
export interface ArchiveManifest {
  formatVersion: number; snapshotId: string; articleId: string; bodyRevision: number; representationHash: string;
  savedAt: string; source: { id: string; name: string }; originalUrl: string; quality: ArchiveSnapshot["quality"];
  completeness: ArchiveSnapshot["status"];
  files: Array<{ path: string; mime: string; bytes: number; sha256: string }>;
  missingResources: Array<{ url: string; reason: string }>;
}
export interface SnapshotView extends ArchiveSnapshot {
  resources:Array<{original_url:string;status:string;error:string|null}>;
  outline:OutlineEntry[];
}
