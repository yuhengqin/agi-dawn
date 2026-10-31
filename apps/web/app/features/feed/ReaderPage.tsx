import { Link } from "react-router";
import type { ReaderPageData } from "./reader.server";
import { ReaderFilters,ReaderToolbar } from "./ReaderFilters";
import { PhoneBar } from "../../components/shell/PhoneBar";
import {ReaderNavigation,readerLink} from "./ReaderNavigation";
import {ReaderListSummary,ReaderPagination} from './ReaderPagination';
import {EngagementProvider,ArticleEngagementBar} from "../item/ArticleEngagement";
import {pageMeta,listPath} from "../../lib/seo";
import {BEIJING_TIMEZONE} from "@agidawn/contracts/time";

export function readerMeta(value:ReaderPageData|undefined){
  const query={...value?.query};
  return pageMeta({title:value&&value.page.page>1?`文章 · 第 ${value.page.page} 页`:"文章",path:listPath("/",query),noindex:Object.keys(query).length>0});
}

export const readerDate=(value:string)=>new Intl.DateTimeFormat("zh-CN",{timeZone:BEIJING_TIMEZONE,dateStyle:"medium"}).format(new Date(value));
export function ReaderPage({page,sources,topics,categories,query}:ReaderPageData) {
  return <section className="reader-feed mx-auto min-w-0 pb-12 [overflow-wrap:anywhere]">
    <PhoneBar title="文章"/>
    <h1 className="sr-only">文章</h1>
    <ReaderToolbar {...{query,sources}}/>
    <ReaderNavigation {...{query,topics,categories}}/>
    <ReaderFilters {...{query,sources,topics,categories}}/>
    <ReaderListSummary {...{page,query}}/>
    <EngagementProvider key={JSON.stringify(query)} items={page.items}>
    {page.items.length===0?<p className="py-12 text-ink-3">没有符合条件的文章。可以调整筛选，或稍后查看更新。</p>:<ol className="divide-y divide-line border-b border-line">
      {page.items.map(item=><li key={item.id} className="reader-feed-row"><article>
        <h2 className="reader-feed-title"><Link viewTransition to={`/items/${item.id}`} className="hover:text-accent">{item.metadataTranslation?.title??item.title}</Link></h2>
        {(item.metadataTranslation?.summary??item.summary)&&<p className="reader-feed-summary">{item.metadataTranslation?.summary??item.summary}</p>}
        <div className="reader-feed-meta flex flex-col gap-x-6 gap-y-1 text-ink-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Link className="hover:underline" to={readerLink(query,{sourceId:item.source.id})}>{item.source.name}</Link>
            <time dateTime={item.publishedAt??item.discoveredAt}>{item.publishedAt?'':'收录于 '}{readerDate(item.publishedAt??item.discoveredAt)}</time>
            {item.bodyState.status==='pending'&&<span className="reader-body-status">全文暂未就绪</span>}
            {item.bodyState.status==='partial'&&<span className="reader-body-status" title="正文有缺失，请对照原文">正文不完整</span>}
          </div>
          <ArticleEngagementBar item={item} compact/>
        </div>
      </article></li>)}
    </ol>}
    </EngagementProvider>
    <ReaderPagination {...{page,query}}/>
  </section>;
}
