import { Link, useLocation } from "react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { matchRanges, searchSnippet, searchWords, visibleSummaryPrefix } from "@agidawn/contracts/search";
import type { ReaderItemSummary, ReaderMatch } from "@agidawn/contracts/site";
import type { ReaderPageData } from "./reader.server";
import { ReaderFilters,ReaderToolbar } from "./ReaderFilters";
import { PhoneBar } from "../../components/shell/PhoneBar";
import {ReaderNavigation,readerLink} from "./ReaderNavigation";
import {ReaderListSummary,ReaderPagination} from './ReaderPagination';
import {EngagementProvider,ArticleEngagementBar} from "../item/ArticleEngagement";
import {pageMeta,listPath} from "../../lib/seo";
import {readerDate} from "../../lib/format";
import {SearchHighlight} from './SearchHighlight';
import {useReaderQuery} from './useReaderQuery';
import {IconCalendar,IconClock,IconDoc} from '../../components/icons';

export function readerMeta(value:ReaderPageData|undefined){
  const query={...value?.query};
  const parts:string[]=[];
  if(query.q)parts.push(`搜索“${query.q}”`);
  const categoryName=query.category?value?.categories.find(c=>c.id===query.category)?.name:undefined;
  if(categoryName)parts.push(categoryName);
  const topicName=query.topic?value?.topics.find(t=>t.slug===query.topic)?.name:undefined;
  if(topicName)parts.push(topicName);
  const sourceName=query.sourceId?value?.sources.find(s=>s.id===query.sourceId)?.name:undefined;
  if(sourceName)parts.push(sourceName);
  const base=parts.length?`${parts.join(' · ')} · 文章`:'文章';
  const title=value&&value.page.page>1?`${base} · 第 ${value.page.page} 页`:base;
  return pageMeta({title,path:listPath("/",query),noindex:Object.keys(query).length>0});
}

const recoveryLink="inline-flex min-h-10 items-center text-sm text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const matchFieldLabels={title:'标题',summary:'摘要',source:'来源',topic:'主题',body:'正文'} as const;

function ReaderFeedRow({item,query,words,target,listReturn}:{
  item:ReaderItemSummary;query:Record<string,string>;words:readonly string[];target:Record<string,string>;listReturn?:{idx:number;to:string};
}){
  const title=item.metadataTranslation?.title??item.title;
  const rawSummary=item.metadataTranslation?.summary??item.summary;
  const summary=rawSummary&&item.summaryTruncated&&!/[.!?。！？…]["'”’）)]*$/.test(rawSummary.trim())?rawSummary+'…':rawSummary;
  const fullDisplayed=[title,summary??''].join(' ');
  const missingFromCard=words.filter(word=>matchRanges(fullDisplayed,[word]).length===0);
  const summaryOnlyWords=summary?words.filter(word=>matchRanges(title,[word]).length===0&&matchRanges(summary,[word]).length>0):[];
  const ssrSummaryVisible=summary?visibleSummaryPrefix(summary,112):'';
  const ssrClipped=summaryOnlyWords.filter(word=>matchRanges(ssrSummaryVisible,[word]).length===0);
  const [clippedWords,setClippedWords]=useState<string[]>(ssrClipped);
  const summaryRef=useRef<HTMLParagraphElement>(null);
  const summaryKey=summaryOnlyWords.join('\0');
  useLayoutEffect(()=>{
    const el=summaryRef.current;
    if(!el||!summaryOnlyWords.length){setClippedWords(prev=>prev.length?[]:prev);return;}
    const check=()=>{
      if(el.scrollHeight<=el.clientHeight+1){setClippedWords(prev=>prev.length?[]:prev);return;}
      const box=el.getBoundingClientRect();
      const visibleMarks=[...el.querySelectorAll('mark')].filter(mark=>{
        const rects=[...mark.getClientRects()];
        return rects.length>0&&rects.every(rect=>rect.top<box.bottom-2&&rect.bottom<=box.bottom+2);
      }).map(mark=>mark.textContent??'').join(' ');
      const next=summaryOnlyWords.filter(word=>matchRanges(visibleMarks,[word]).length===0);
      setClippedWords(prev=>prev.length===next.length&&prev.every((word,i)=>word===next[i])?prev:next);
    };
    check();
    const observer=new ResizeObserver(check);
    observer.observe(el);
    return()=>observer.disconnect();
  },[summary,summaryKey]);
  const missingWords=[...new Set([...missingFromCard,...clippedWords])];
  const shownSummaryLanguage:ReaderMatch['language']=item.metadataTranslation?.summary?'translation':'original';
  const fullFieldText=(hit:ReaderMatch)=>
    hit.field==='title'?(hit.language==='translation'?item.metadataTranslation?.title:item.title)
    :hit.field==='summary'?(hit.language==='translation'?item.metadataTranslation?.summary:item.summary)
    :null;
  const focusSnippet=(hit:ReaderMatch,need:readonly string[]):ReaderMatch=>{
    if(!need.length||matchRanges(hit.snippet,need).length>0)return hit;
    const source=fullFieldText(hit);
    return source&&matchRanges(source,need).length>0?{...hit,snippet:searchSnippet(source,need)}:hit;
  };
  const coverage=(snippet:string,need:readonly string[])=>need.filter(word=>matchRanges(snippet,[word]).length>0).length;
  const candidates:ReaderMatch[]=(item.matches??[]).flatMap(raw=>{
    if(raw.field==='body'||raw.field==='topic')return [raw];
    if(missingFromCard.length>0&&raw.language==='original'&&!!item.metadataTranslation&&['title','summary'].includes(raw.field)){
      const hit=focusSnippet(raw,missingFromCard);
      return coverage(hit.snippet,missingFromCard)>0?[hit]:[];
    }
    if(clippedWords.length>0&&raw.field==='summary'&&raw.language===shownSummaryLanguage){
      const hit=focusSnippet(raw,clippedWords);
      return coverage(hit.snippet,clippedWords)>0?[hit]:[];
    }
    return [];
  });
  if(clippedWords.length>0&&summary&&!candidates.some(hit=>coverage(hit.snippet,clippedWords)>0)){
    candidates.push({field:'summary',language:shownSummaryLanguage,snippet:searchSnippet(summary,clippedWords)});
  }
  const pickBest=(list:readonly ReaderMatch[],need:readonly string[])=>{
    let best:ReaderMatch|undefined,bestCount=0;
    for(const hit of list){const count=coverage(hit.snippet,need);if(count>bestCount){best=hit;bestCount=count;}}
    return best;
  };
  const extra=(missingFromCard.length>0?pickBest(candidates,missingFromCard):undefined)
    ??(missingWords.length>0?pickBest(candidates,missingWords):undefined)
    ??candidates[0];
  const search=query.q?new URLSearchParams({q:query.q}):null;
  if(search)for(const hit of item.matches??[]){
    if(hit.language==='original'&&!!item.metadataTranslation&&['title','summary'].includes(hit.field)){
      const focused=focusSnippet(hit,missingFromCard);
      if(missingFromCard.length===0||coverage(focused.snippet,missingFromCard)===0)continue;
    }
    search.append('match',`${hit.field}:${hit.language}`);
  }
  return <li className="reader-feed-row"><article>
    <Link viewTransition to={`/items/${item.id}${search?'?'+search:''}`} state={listReturn?{returnToList:listReturn}:undefined} aria-label={title} draggable={false} className="reader-feed-entry">
      <h2 className="reader-feed-title"><SearchHighlight text={title} query={query.q}/></h2>
      {summary&&<p ref={summaryRef} className="reader-feed-summary"><SearchHighlight text={summary} query={query.q}/></p>}
      {extra&&<p className="reader-search-match">{matchFieldLabels[extra.field]}{extra.language==='translation'?'译文':'原文'}命中：<SearchHighlight text={extra.snippet} query={query.q}/></p>}
    </Link>
    <div className="reader-feed-meta flex flex-col gap-x-6 gap-y-1 text-ink-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><Link className="reader-meta-item hover:underline" to={readerLink(target,{sourceId:item.source.id})}><IconDoc size={15}/><span>{item.source.name}</span></Link>
        <time className="reader-meta-item whitespace-nowrap" dateTime={item.publishedAt??item.discoveredAt} title={item.publishedAt?'发布时间':'收录时间'}><IconCalendar size={15}/><span>{item.publishedAt?'':'收录于 '}{readerDate(item.publishedAt??item.discoveredAt)}</span></time>
        {item.readingMinutes&&<span className="reader-meta-item whitespace-nowrap"><IconClock size={15}/><span>约 {item.readingMinutes} 分钟</span></span>}
        {item.bodyState.status==='pending'&&<span className="reader-body-status">全文暂未就绪</span>}
        {item.bodyState.status==='partial'&&item.bodyState.issues.some(issue=>issue.kind!=='missing-figure')&&<span className="reader-body-status" title="正文有缺失，请对照原文">正文不完整</span>}
        {(item.bodyState.status==='not-permitted'||item.bodyState.status==='unavailable')&&!item.readingMinutes&&<span className="reader-body-status" title="本站仅提供摘要，点击进入后可前往原文阅读">仅摘要</span>}
      </div>
      <ArticleEngagementBar item={item} compact/>
    </div>
  </article></li>;
}

export function ReaderPage({page,sources,topics,categories,query,latestArticleDate}:ReaderPageData) {
  const location=useLocation();
  const datePickerTrigger=useRef<HTMLElement>(null);
  const target=useReaderQuery(query);
  const rawIdx=typeof window!=='undefined'?(window.history.state as {idx?:unknown}|null)?.idx:undefined;
  const [syncedIdx,setSyncedIdx]=useState<number|undefined>(typeof rawIdx==='number'?rawIdx:undefined);
  useEffect(()=>{
    const idx=(window.history.state as {idx?:unknown}|null)?.idx;
    if(typeof idx==='number')setSyncedIdx(idx);
  },[location.key,location.pathname,location.search,location.hash]);
  const listReturn=typeof window!=='undefined'?{idx:(typeof rawIdx==='number'?rawIdx:syncedIdx)??0,to:location.pathname+location.search}:undefined;
  const hasDates=!!(query.from||query.to);
  const activeFilters=[query.category,query.topic,query.sourceId,query.q].filter(Boolean).length;
  const hasRecoveryLinks=!!(query.sourceId||query.q||(!hasDates&&(query.category||query.topic)));
  const words=query.q?searchWords(query.q).slice(0,6):[];
  const emptyDateTitle=query.from&&query.to?`${query.from===query.to?query.from:`${query.from} 至 ${query.to}`} 暂无文章`:query.from?`${query.from} 起暂无文章`:`截至 ${query.to} 暂无文章`;
  return <section className="reader-feed mx-auto min-w-0 pb-12 [overflow-wrap:anywhere]">
    <PhoneBar title="文章"/>
    <h1 className="sr-only">文章</h1>
    <ReaderToolbar {...{query,sources,datePickerTrigger}}/>
    <ReaderNavigation {...{query,topics,categories}}/>
    <ReaderFilters {...{query,sources,topics,categories}}/>
    <ReaderListSummary page={page}/>
    <EngagementProvider key={JSON.stringify(query)} items={page.items}>
    {page.items.length===0?<div className="space-y-4 py-10">
      {hasDates?<>
      <h2 className="text-base font-medium text-ink">{emptyDateTitle}</h2>
      <p className="text-sm text-ink-3">{latestArticleDate?'可以查看其他日期的文章，其他筛选条件将保留。':'当前日期内没有符合条件的文章，可以解除日期限制或调整其他筛选。'}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link to={readerLink(target,{from:null,to:null})} className="inline-flex min-h-10 items-center rounded-mark bg-accent px-4 text-sm text-accent-contrast hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">不限日期，查看文章</Link>
        <button type="button" className="min-h-10 text-sm text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent" onClick={()=>{datePickerTrigger.current?.click();datePickerTrigger.current?.focus();}}>重新选择日期</button>
      </div>
      {latestArticleDate&&<p className="text-sm text-ink-3">最近有文章的日期：<time dateTime={latestArticleDate}>{latestArticleDate}</time><span className="mx-2">·</span><Link to={readerLink(target,{from:latestArticleDate,to:latestArticleDate})} aria-label={`查看 ${latestArticleDate} 的文章`} className="inline-flex min-h-9 items-center text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent">查看当天文章</Link></p>}
      </>:<>
        <h2 className="text-base font-medium text-ink">没有符合条件的文章</h2>
        <p className="text-sm text-ink-3">可以移除部分筛选条件，或稍后查看更新。</p>
      </>}
      {hasRecoveryLinks&&<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {!hasDates&&query.category&&<Link to={readerLink(target,{category:null})} className={recoveryLink}>移除类别限制</Link>}
        {!hasDates&&query.topic&&<Link to={readerLink(target,{topic:null})} className={recoveryLink}>移除主题限制</Link>}
        {query.sourceId&&<Link to={readerLink(target,{sourceId:null})} className={recoveryLink}>移除来源限制</Link>}
        {query.q&&<Link to={readerLink(target,{q:null})} className={recoveryLink}>清除关键词</Link>}
        {!hasDates&&activeFilters>=2&&<Link to={readerLink(target.limit?{limit:target.limit}:{},{})} className={recoveryLink}>清除全部筛选</Link>}
      </div>}
    </div>:<ol className="divide-y divide-line border-b border-line">
      {page.items.map(item=><ReaderFeedRow key={item.id} item={item} query={query} words={words} target={target} listReturn={listReturn}/>)}
    </ol>}
    </EngagementProvider>
    {page.total>0&&<ReaderPagination {...{page,query}}/>}
  </section>;
}
