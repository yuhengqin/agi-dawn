import {data,Link,useLoaderData} from "react-router";
import {useEffect,useState} from 'react';
import type {Route} from "./+types/item";
import type {ReaderItemDetail} from "@agidawn/contracts/site";
import {ARTICLE_FOOTER} from "@agidawn/site";
import {loadOr404} from "../lib/api.server";
import {PhoneBar} from "../components/shell/PhoneBar";
import {IconCalendar,IconDoc,IconExternal,IconClock,IconUser} from "../components/icons";
import {ArticleLayout} from "../components/ui/Page";
import {ArticleBody} from "../features/item/ArticleBody";
import {ArticleSearch} from "../features/item/ArticleSearch";
import {ArticleTools} from "../features/item/ArticleTools";
import {FigureNotice} from "../features/item/FigureNotice";
import {ArticleOutline,ArticleProgress,MobileArticleOutline,useArticleReading} from '../features/item/ArticleReading';
import {EngagementProvider,ArticleEngagementBar} from "../features/item/ArticleEngagement";
import {readerDate} from "../features/feed/ReaderPage";
import {transitionAppearance} from "../lib/motion";
import {webModules} from "../site-modules";
import {pageMeta} from "../lib/seo";
export {readerHeaders as headers} from "../features/feed/reader.server";
export const handle={home:"featured"};
export const shouldRevalidate=()=>true;
export async function loader({request,params}:Route.LoaderArgs){return data(await loadOr404<ReaderItemDetail>(`/api/site/items/${params.id}`,{signal:request.signal}),{headers:{"Cache-Control":"no-store"}});}
export function meta({loaderData}:Route.MetaArgs){return pageMeta({title:loaderData?.metadataTranslation?.title??loaderData?.title??"文章",path:`/items/${loaderData?.id??""}`,description:loaderData?.metadataTranslation?.summary??loaderData?.summary,type:"article",jsonLd:loaderData?{
  "@context":"https://schema.org","@type":"Article",headline:loaderData.metadataTranslation?.title??loaderData.title,isBasedOn:loaderData.links.original,
  ...(loaderData.publishedAt?{datePublished:loaderData.publishedAt}:{}),...(loaderData.author?{author:{"@type":"Person",name:loaderData.author}}:{}),
}:undefined});}

const notices={pending:"全文暂未就绪。可以先阅读摘要，或访问原文。",unavailable:"暂时无法取得全文，请访问原文。",partial:"正文有缺失，请对照原文。","not-permitted":"本来源暂以摘要与原文链接展示。",ready:""};
export default function Item(){const item=useLoaderData<typeof loader>();return <ItemReading key={item.id} item={item}/>;}
function ItemReading({item}:{item:ReaderItemDetail}){const [focus,setFocus]=useState(false),[outlineCollapsed,setOutlineCollapsed]=useState(false);
  const translated=item.body?.language==='translation'?item.body:null,metadata=item.metadataTranslation,outline=item.body?.outline??[],html=item.body?.html??null;
  const languageLabel=translated?'中文译文':item.body?.contentLanguage==='zh'?'中文正文':null;
  const reading=useArticleReading(outline,html,focus,outlineCollapsed),outlineProps={outline,current:reading.current,navigate:reading.navigate,progress:reading.progress};
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
  return <EngagementProvider items={[item]} trackView={item.id}><div ref={reading.scope} className="public-article-reading" data-reading-focus={focus} data-outline-collapsed={outlineCollapsed}>
  <PhoneBar title="文章"/>
  {html&&<ArticleProgress progress={reading.progress}/>}
  <ArticleLayout readingDisplay right={html&&outline.length?<ArticleOutline {...outlineProps} collapsed={outlineCollapsed} onToggle={()=>{reading.preserve();setOutlineCollapsed(value=>!value);}}/>:undefined}>
    <article className="public-article break-words pb-12 pt-5 lg:pt-0">
      <header className="article-heading"><h1 tabIndex={-1} className="article-title" data-search-content>{metadata?.title??item.title}</h1>
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
      {notices[item.bodyState.status]&&(item.bodyState.status!=='partial'||otherIssues.length>0||!figureIssues.length)&&<p className="article-status" role="status">{item.bodyState.status==='pending'&&!item.intro?'全文暂未就绪，请访问原文。':notices[item.bodyState.status]}</p>}
      {item.bodyState.refreshPending&&<p className="article-status">正文正在更新，当前显示已保存版本。</p>}
      <FigureNotice issues={figureIssues} onDismiss={()=>reading.scope.current?.querySelector<HTMLElement>('.floating-tools summary')?.focus({preventScroll:true})}/>
      {otherIssues.length>0&&<ul className="article-status list-disc pl-5">{otherIssues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul>}
      {translated&&!translated.complete&&<p className="article-status" role="status">译文尚不完整，未译段落保留原文；可打开原文对照。</p>}
      {html&&<div ref={reading.body} className="article-reading-body" role="region" aria-label="文章正文" data-search-content><ArticleBody html={html}/></div>}
      <footer role="contentinfo" aria-label="文章后续阅读" className="article-footer">
        {!ARTICLE_FOOTER.hideActionsForSources.includes(item.source.id)&&<div className="flex flex-wrap items-center gap-x-6 gap-y-2"><span className="text-sm text-ink-3">{item.source.name}</span><a href={item.links.original} target="_blank" rel="noreferrer" aria-label="文末打开原文" className="article-tool-link text-accent">打开原文<IconExternal size={16}/></a><ArticleEngagementBar item={item} labelPrefix="文末" showViews={false}/></div>}
        {item.topics.length>0&&<nav aria-label="文末主题" className="article-topics">{item.topics.map(topic=><Link key={topic.slug} to={`/?${new URLSearchParams({topic:topic.slug})}`}>{topic.name}</Link>)}</nav>}
        {!!item.related?.length&&<div className="mt-6"><h2 className="text-sm font-medium">继续阅读</h2><ul className="mt-3 space-y-3">{item.related.map(related=><li key={related.id}><Link viewTransition to={'/items/'+related.id} className="text-accent hover:underline">{related.metadataTranslation?.title??related.title}</Link><span className="ml-3 text-xs text-ink-3">{related.source.name}</span></li>)}</ul></div>}
      </footer>
      {webModules().map(module=>module.articleTools?<module.articleTools key={module.name} articleId={item.id}/>:null)}
    </article>
  </ArticleLayout>
  <ArticleTools focus={focus} onFocus={()=>{reading.preserve();transitionAppearance(()=>setFocus(value=>!value));}} onBackToTop={reading.stop}/>
  </div></EngagementProvider>;}
