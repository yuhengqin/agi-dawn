import {data,Link,useLoaderData,useLocation,useNavigate,useRouteLoaderData} from "react-router";
import {useEffect,useRef,useState} from 'react';
import {createHash} from 'node:crypto';
import type {Route} from "./+types/item";
import type {loader as rootLoader} from "../root";
import type {ReaderItemDetail} from "@agidawn/contracts/site";
import {ARTICLE_FOOTER} from "@agidawn/site";
import {loadOr404} from "../lib/api.server";
import {PhoneBar} from "../components/shell/PhoneBar";
import {IconArrowLeft,IconCalendar,IconDoc,IconExternal,IconClock,IconUser} from "../components/icons";
import {ArticleLayout} from "../components/ui/Page";
import {ArticleBody} from "../features/item/ArticleBody";
import {ArticleSearch} from "../features/item/ArticleSearch";
import {ArticleTools} from "../features/item/ArticleTools";
import {FigureNotice} from "../features/item/FigureNotice";
import {ArticleOutline,ArticleProgress,MobileArticleOutline,useArticleReading} from '../features/item/ArticleReading';
import {EngagementProvider,ArticleEngagementBar} from "../features/item/ArticleEngagement";
import {readerDate} from "../lib/format";
import {isHydrated} from "../lib/hydration";
import {transitionAppearance} from "../lib/motion";
import {webModules} from "../site-modules";
import {pageMeta} from "../lib/seo";
export {readerHeaders as headers} from "../features/feed/reader.server";
export const handle={home:"featured"};
export const shouldRevalidate=()=>true;
export async function loader({request,params}:Route.LoaderArgs){
  const item=await loadOr404<ReaderItemDetail>(`/api/site/items/${params.id}`,{signal:request.signal});
  const bodyKey=item.body?createHash('sha256').update('passage-v1\0'+item.body.language+'\0'+item.body.html).digest('hex'):null;
  return data({...item,bodyKey},{headers:{"Cache-Control":"no-store"}});
}
export function meta({loaderData}:Route.MetaArgs){return pageMeta({title:loaderData?.metadataTranslation?.title??loaderData?.title??"文章",path:`/items/${loaderData?.id??""}`,description:loaderData?.metadataTranslation?.summary??loaderData?.summary,type:"article",jsonLd:loaderData?{
  "@context":"https://schema.org","@type":"Article",headline:loaderData.metadataTranslation?.title??loaderData.title,isBasedOn:loaderData.links.original,
  ...(loaderData.publishedAt?{datePublished:loaderData.publishedAt}:{}),...(loaderData.author?{author:{"@type":"Person",name:loaderData.author}}:{}),
}:undefined});}

const notices={pending:"全文暂未就绪。可以先阅读摘要，或访问原文。",unavailable:"暂时无法取得全文，请访问原文。",partial:"正文有缺失，请对照原文。","not-permitted":"本来源暂以摘要与原文链接展示。",ready:""};
export default function Item(){const item=useLoaderData<typeof loader>();return <ItemReading key={item.id} item={item}/>;}
function ItemReading({item}:{item:ReaderItemDetail&{bodyKey:string|null}}){const [focus,setFocus]=useState(false),[outlineCollapsed,setOutlineCollapsed]=useState(false);
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const location=useLocation(),navigate=useNavigate();
  const [clientReady,setClientReady]=useState(isHydrated);
  useEffect(()=>{if(!clientReady)setClientReady(true);},[clientReady]);
  const historyUsr=clientReady?(window.history.state as {usr?:{returnToList?:{idx?:unknown;to?:unknown}}}|null)?.usr:undefined;
  const rawReturn=clientReady?((location.state as {returnToList?:{idx?:unknown;to?:unknown}}|null)?.returnToList??historyUsr?.returnToList):undefined;
  const parsedReturn=rawReturn&&typeof rawReturn.to==='string'&&rawReturn.to.startsWith('/')&&!rawReturn.to.startsWith('//')
    ?{to:rawReturn.to,idx:typeof rawReturn.idx==='number'?rawReturn.idx:undefined}:null;
  const savedReturn=useRef<{to:string;idx?:number}|null>(null);
  if(parsedReturn)savedReturn.current=parsedReturn;
  const listReturn=parsedReturn??savedReturn.current;
  const root=useRouteLoaderData<typeof rootLoader>('root');
  const categoryName=item.category?root?.categories?.find(category=>category.id===item.category)?.name:undefined;
  const translated=item.body?.language==='translation'?item.body:null,metadata=item.metadataTranslation,outline=item.body?.outline??[],html=item.body?.html??null;
  const languageLabel=translated?'中文译文':item.body?.contentLanguage==='zh'?'中文正文':null;
  const reading=useArticleReading(outline,html,focus,outlineCollapsed);
  const outlineProps={outline,current:reading.current,navigate:reading.navigate,progress:reading.progress,expanded,
    onExpand:(id:string,open:boolean)=>setExpanded(previous=>({...previous,[id]:open}))};
  useEffect(()=>{
    if(!focus)return;
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('[aria-modal="true"],[role="menu"]')||reading.scope.current?.querySelector('details[open],[role="tooltip"]'))return;
      if(event.target instanceof Element&&event.target.closest('input,textarea,[contenteditable="true"]'))return;
      event.preventDefault();reading.preserve();transitionAppearance(()=>setFocus(false));
      reading.scope.current?.querySelector<HTMLButtonElement>('.floating-tool-button[aria-pressed]')?.focus({preventScroll:true});
    };
    window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);
  },[focus,reading.preserve]);
  const figureIssues=item.bodyState.issues.filter(issue=>issue.kind==='missing-figure'),otherIssues=item.bodyState.issues.filter(issue=>issue.kind!=='missing-figure');
  const statusNotice=notices[item.bodyState.status]&&(!html||item.bodyState.status!=='partial'||otherIssues.length>0||!figureIssues.length)?(item.bodyState.status==='pending'&&!item.intro?'全文暂未就绪，请访问原文。':notices[item.bodyState.status]):'';
  const showFooterActions=!!html&&!ARTICLE_FOOTER.hideActionsForSources.includes(item.source.id);
  const showFooter=showFooterActions||item.topics.length>0||!!item.related?.length;
  return <EngagementProvider items={[item]} trackView={item.id}><div ref={reading.scope} className="public-article-reading" data-reading-focus={focus} data-outline-collapsed={outlineCollapsed}>
  <PhoneBar title="文章"/>
  {html&&<ArticleProgress progress={reading.progress}/>}
  <ArticleLayout readingDisplay right={html&&outline.length?<ArticleOutline {...outlineProps} collapsed={outlineCollapsed} onToggle={()=>{reading.preserve();setOutlineCollapsed(value=>!value);}}/>:undefined}>
    <article className="public-article break-words pb-12 pt-5 lg:pt-0">
      <header className="article-heading">
        <div className="article-top-bar">
          <Link to={listReturn?.to??'/'} className="article-back-link" onClick={event=>{
            if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
            const currentIdx=typeof window!=='undefined'?(window.history.state as {idx?:number}|null)?.idx:undefined;
            if(listReturn&&typeof listReturn.idx==='number'&&typeof currentIdx==='number'&&currentIdx>listReturn.idx){event.preventDefault();void navigate(listReturn.idx-currentIdx);}
          }}><IconArrowLeft size={15}/><span>返回列表</span></Link>
          {categoryName&&<span className="article-category-badge">{categoryName}</span>}
        </div>
        <h1 tabIndex={-1} className="article-title" data-search-content>{metadata?.title??item.title}</h1>
        <div className="article-meta"><div className="article-byline">
          <Link className="article-source" data-search-content to={`/?${new URLSearchParams({sourceId:item.source.id})}`}><IconDoc size={15}/>{item.source.name}</Link>
          {item.author&&<span className="article-author"><IconUser size={15}/><span><span className="sr-only">作者：</span>{item.author}</span></span>}
          <time dateTime={item.publishedAt??item.discoveredAt}><IconCalendar size={15}/><span><span className={item.publishedAt?"sr-only":undefined}>{item.publishedAt?"发布时间：":"收录时间："}</span>{readerDate(item.publishedAt??item.discoveredAt)}</span></time>
          <div className="article-reading-meta"><ArticleEngagementBar item={item} compact/>
          {item.readingMinutes&&<span className="reader-meta-item whitespace-nowrap"><IconClock size={15}/><span>约 {item.readingMinutes} 分钟</span></span>}
          {languageLabel&&<span className="article-language">{languageLabel}</span>}
          </div>
        </div>
          <a href={item.links.original} target="_blank" rel="noreferrer" className="article-tool-link article-original-link text-accent">打开原文<IconExternal size={16}/></a>
          {item.topics.length>0&&<nav aria-label="所属主题" className="article-topics">{item.topics.map(topic=><Link key={topic.slug} data-search-content to={`/?${new URLSearchParams({topic:topic.slug})}`}>{topic.name}</Link>)}</nav>}
        </div>
        {item.intro&&<p className="article-intro" data-search-content>{item.intro}</p>}
      </header>
      <ArticleSearch item={item} onNavigate={reading.stop}/>
      {html&&outline.length>0&&<div ref={reading.toolbar} className="article-reading-toolbar" data-reading-controls><MobileArticleOutline {...outlineProps}/></div>}
      {statusNotice&&(!html?<div className="article-status-card"><p className="article-status" role="status">{statusNotice}</p><a href={item.links.original} target="_blank" rel="noreferrer" className="article-tool-link article-original-cta">前往原文阅读<IconExternal size={15}/></a></div>:<p className="article-status" role="status">{statusNotice}</p>)}
      {item.bodyState.refreshPending&&<p className="article-status">正文正在更新，当前显示已保存版本。</p>}
      <FigureNotice issues={figureIssues} onDismiss={()=>reading.scope.current?.querySelector<HTMLElement>('.floating-tools summary')?.focus({preventScroll:true})}/>
      {otherIssues.length>0&&<ul className="article-status list-disc pl-5">{otherIssues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul>}
      {translated&&!translated.complete&&<p className="article-status" role="status">译文尚不完整，未译段落保留原文；可打开原文对照。</p>}
      {html&&<div ref={reading.body} className="article-reading-body" role="region" aria-label="文章正文" tabIndex={-1} data-search-content><ArticleBody html={html}/></div>}
      {showFooter&&<footer role="contentinfo" aria-label="文章后续阅读" className="article-footer">
        {showFooterActions&&<div className="flex flex-wrap items-center gap-x-6 gap-y-2"><Link to={`/?${new URLSearchParams({sourceId:item.source.id})}`} aria-label={`查看更多 ${item.source.name} 文章`} className="text-sm text-ink-3 hover:text-accent hover:underline">{item.source.name}</Link><a href={item.links.original} target="_blank" rel="noreferrer" aria-label="文末打开原文" className="article-tool-link text-accent">打开原文<IconExternal size={16}/></a><ArticleEngagementBar item={item} labelPrefix="文末" showViews={false}/></div>}
        {item.topics.length>0&&<nav aria-label="文末主题" className="article-topics">{item.topics.map(topic=><Link key={topic.slug} to={`/?${new URLSearchParams({topic:topic.slug})}`}>{topic.name}</Link>)}</nav>}
        {!!item.related?.length&&<div className="article-related mt-6"><h2 className="text-sm font-medium">继续阅读</h2><ul className="article-related-list mt-3 space-y-3">{item.related.map(related=><li key={related.id} className="article-related-item"><Link viewTransition to={'/items/'+related.id} state={listReturn?{returnToList:listReturn}:undefined} aria-label={related.metadataTranslation?.title??related.title} className="article-related-link"><span className="article-related-title text-accent">{related.metadataTranslation?.title??related.title}</span><span className="article-related-meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3"><span>{related.source.name}</span><time dateTime={related.publishedAt??related.discoveredAt}>{readerDate(related.publishedAt??related.discoveredAt)}</time>{!!related.readingMinutes&&<span>约 {related.readingMinutes} 分钟</span>}</span></Link></li>)}</ul></div>}
      </footer>}
      {webModules().map(module=>module.articleTools?<module.articleTools key={module.name} articleId={item.id} passages={item.bodyKey?{
        body:reading.body,bodyKey:item.bodyKey,title:metadata?.title??item.title,credit:[item.author,item.source.name].filter(Boolean).join(' · '),
      }:undefined}/>:null)}
    </article>
  </ArticleLayout>
  <ArticleTools focus={focus} hasBody={!!html} onFocus={()=>{reading.preserve();transitionAppearance(()=>setFocus(value=>!value));}} onBackToTop={reading.stop}/>
  </div></EngagementProvider>;}
