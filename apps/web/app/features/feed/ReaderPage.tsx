import { Link } from "react-router";
import { useRef } from "react";
import type { ReaderPageData } from "./reader.server";
import { ReaderFilters,ReaderToolbar } from "./ReaderFilters";
import { PhoneBar } from "../../components/shell/PhoneBar";
import {ReaderNavigation,readerLink} from "./ReaderNavigation";
import {ReaderListSummary,ReaderPagination} from './ReaderPagination';
import {EngagementProvider,ArticleEngagementBar} from "../item/ArticleEngagement";
import {pageMeta,listPath} from "../../lib/seo";
import {BEIJING_TIMEZONE} from "@agidawn/contracts/time";
import {SearchHighlight} from './SearchHighlight';

export function readerMeta(value:ReaderPageData|undefined){
  const query={...value?.query};
  return pageMeta({title:value&&value.page.page>1?`文章 · 第 ${value.page.page} 页`:"文章",path:listPath("/",query),noindex:Object.keys(query).length>0});
}

export const readerDate=(value:string)=>new Intl.DateTimeFormat("zh-CN",{timeZone:BEIJING_TIMEZONE,dateStyle:"medium"}).format(new Date(value));
export function ReaderPage({page,sources,topics,categories,query,latestArticleDate}:ReaderPageData) {
  const datePickerTrigger=useRef<HTMLElement>(null);
  const hasDates=!!(query.from||query.to);
  const emptyDateTitle=query.from&&query.to?`${query.from===query.to?query.from:`${query.from} 至 ${query.to}`} 暂无文章`:query.from?`${query.from} 起暂无文章`:`截至 ${query.to} 暂无文章`;
  return <section className="reader-feed mx-auto min-w-0 pb-12 [overflow-wrap:anywhere]">
    <PhoneBar title="文章"/>
    <h1 className="sr-only">文章</h1>
    <ReaderToolbar {...{query,sources,datePickerTrigger}}/>
    <ReaderNavigation {...{query,topics,categories}}/>
    <ReaderFilters {...{query,sources,topics,categories}}/>
    <ReaderListSummary page={page}/>
    <EngagementProvider key={JSON.stringify(query)} items={page.items}>
    {page.items.length===0?hasDates?<div className="space-y-4 py-10">
      <h2 className="text-base font-medium text-ink">{emptyDateTitle}</h2>
      <p className="text-sm text-ink-3">{latestArticleDate?'可以查看其他日期的文章，其他筛选条件将保留。':'当前日期内没有符合条件的文章，可以解除日期限制或调整其他筛选。'}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link to={readerLink(query,{from:null,to:null})} className="inline-flex min-h-10 items-center rounded-mark bg-accent px-4 text-sm text-accent-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">不限日期，查看文章</Link>
        <button type="button" className="min-h-10 text-sm text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent" onClick={()=>{datePickerTrigger.current?.click();datePickerTrigger.current?.focus();}}>重新选择日期</button>
      </div>
      {latestArticleDate&&<p className="text-sm text-ink-3">最近有文章的日期：<time dateTime={latestArticleDate}>{latestArticleDate}</time><span className="mx-2">·</span><Link to={readerLink(query,{from:latestArticleDate,to:latestArticleDate})} aria-label={`查看 ${latestArticleDate} 的文章`} className="inline-flex min-h-9 items-center text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent">查看当天文章</Link></p>}
    </div>:<p className="py-12 text-ink-3">没有符合条件的文章。可以调整筛选，或稍后查看更新。</p>:<ol className="divide-y divide-line border-b border-line">
      {page.items.map(item=>{const title=item.metadataTranslation?.title??item.title,rawSummary=item.metadataTranslation?.summary??item.summary;
        const summary=rawSummary&&item.summaryTruncated&&!/[.!?。！？…]["'”’）)]*$/.test(rawSummary.trim())?rawSummary+'…':rawSummary;
        const extra=item.matches?.find(hit=>hit.field==='body'||hit.field==='topic'||hit.language==='original'&&!!item.metadataTranslation&&['title','summary'].includes(hit.field));
        return <li key={item.id} className="reader-feed-row"><article>
        <Link viewTransition to={`/items/${item.id}`} aria-label={title} draggable={false} className="reader-feed-entry">
          <h2 className="reader-feed-title"><SearchHighlight text={title} query={query.q}/></h2>
          {summary&&<p className="reader-feed-summary"><SearchHighlight text={summary} query={query.q}/></p>}
          {extra&&<p className="reader-search-match">{({title:'标题',summary:'摘要',source:'来源',topic:'主题',body:'正文'})[extra.field]}{extra.language==='translation'?'译文':'原文'}命中：<SearchHighlight text={extra.snippet} query={query.q}/></p>}
        </Link>
        <div className="reader-feed-meta flex flex-col gap-x-6 gap-y-1 text-ink-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Link className="hover:underline" to={readerLink(query,{sourceId:item.source.id})}>{item.source.name}</Link>
            <time dateTime={item.publishedAt??item.discoveredAt}>{item.publishedAt?'':'收录于 '}{readerDate(item.publishedAt??item.discoveredAt)}</time>
            {item.readingMinutes&&<span>约 {item.readingMinutes} 分钟</span>}
            {item.bodyState.status==='pending'&&<span className="reader-body-status">全文暂未就绪</span>}
            {item.bodyState.status==='partial'&&item.bodyState.issues.some(issue=>issue.kind!=='missing-figure')&&<span className="reader-body-status" title="正文有缺失，请对照原文">正文不完整</span>}
          </div>
          <ArticleEngagementBar item={item} compact/>
        </div>
      </article></li>;})}
    </ol>}
    </EngagementProvider>
    {page.total>0&&<ReaderPagination {...{page,query}}/>}
  </section>;
}
