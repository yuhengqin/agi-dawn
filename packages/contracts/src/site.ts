// Public reading payloads contain no owner state, notes or archive history.
export interface BodyIssue {
  kind:"missing-figure"|"missing-formula"|"truncated-body"|"unsupported-embed";
  message:string;
}
export interface ReaderBodyState {
  status:"pending"|"ready"|"partial"|"unavailable"|"not-permitted";
  bodyRevision:number|null;refreshPending:boolean;issues:BodyIssue[];
}
export interface ReaderItemSummary {
  id:string;title:string;summary:string|null;source:{id:string;name:string};author:string|null;links:{original:string};
  publishedAt:string|null;discoveredAt:string;timelineAt:string;category:string|null;tags:string[];bodyState:ReaderBodyState;
  engagement:ArticleCounts;
  metadataTranslation?:ReaderMetadataTranslation|null;
}
export interface ReaderMetadataTranslation {title:string;summary:string|null}
export interface ArticleCounts {views:number;likes:number}
export interface ArticleEngagement extends ArticleCounts {id:string;liked:boolean}
export interface OutlineEntry {id:string;text:string;level:number}
export interface ReaderTranslation {bodyHtml:string;outline:OutlineEntry[];complete:boolean}
export interface ReaderItemDetail extends ReaderItemSummary {bodyHtml:string|null;outline:OutlineEntry[];topics:TopicLink[];translation?:ReaderTranslation|null}
export const READER_PAGE_SIZES=[25,50,100] as const;
export interface ReaderListQuery {sourceId?:string;category?:string;topic?:string;from?:string;to?:string;q?:string;page?:number;limit?:number}
export interface ReaderListPage {items:ReaderItemSummary[];total:number;page:number;limit:number;pageCount:number}
export interface SiteMeta {changelogVersion:string}
export interface ChangelogRelease {date:string;time:string;kind:"更新"|"优化"|"公告"|"下线";title:string;body:string[];urgent?:true;feature?:unknown}
export interface ChangelogResponse {latestVersion:string;releases:ChangelogRelease[]}
export interface SiteContact {wechatQr:string|null;feishuQr:string|null}
export interface SiteStats {items:number;sources:number}
export type TopicGroupKey="company"|"field"|"genre";
export interface TopicGroup {key:TopicGroupKey;name:string;blurb:string}
export interface TopicLink {slug:string;name:string}
export interface Brand {src:string|null;monogram:string;raster:boolean}
export interface TopicSummary extends TopicLink {
  group:TopicGroupKey;definition:string;brand:Brand|null;total:number;recent:number;indexable:boolean;latest:{title:string;at:string}|null;
}
export interface TopicsResponse {groups:TopicGroup[];topics:TopicSummary[]}
