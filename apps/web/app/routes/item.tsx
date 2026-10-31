import {data,Link,useLoaderData} from "react-router";
import {useState} from 'react';
import type {Route} from "./+types/item";
import type {ReaderItemDetail} from "@agidawn/contracts/site";
import {loadOr404} from "../lib/api.server";
import {PhoneBar} from "../components/shell/PhoneBar";
import {IconDoc,IconExternal,IconClock,IconUser} from "../components/icons";
import {ArticleLayout} from "../components/ui/Page";
import {ArticleBody} from "../features/item/ArticleBody";
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
function ItemReading({item}:{item:ReaderItemDetail}){const [focus,setFocus]=useState(false);
  const translated=item.translation,metadata=item.metadataTranslation,outline=translated?.outline??item.outline,html=translated?.bodyHtml??item.bodyHtml;
  const reading=useArticleReading(outline,html,focus),outlineProps={outline,current:reading.current,navigate:reading.navigate,progress:reading.progress};
  const figureIssues=item.bodyState.issues.filter(issue=>issue.kind==='missing-figure'),otherIssues=item.bodyState.issues.filter(issue=>issue.kind!=='missing-figure');
  return <EngagementProvider items={[item]} trackView={item.id}><div ref={reading.scope} className="public-article-reading" data-reading-focus={focus}>
  <PhoneBar title="文章"/>
  {html&&<ArticleProgress progress={reading.progress}/>}
  <ArticleLayout readingDisplay right={html&&outline.length?<ArticleOutline {...outlineProps}/>:undefined}>
    <article className="public-article break-words pb-12 pt-5 lg:pt-0">
      <header className="article-heading"><h1 tabIndex={-1} className="article-title">{metadata?.title??item.title}</h1>
        <div className="article-meta"><div className="article-byline">
          <Link className="article-source" to={`/?${new URLSearchParams({sourceId:item.source.id})}`}><IconDoc size={15}/>{item.source.name}</Link>
          {item.author&&<span className="article-author"><IconUser size={15}/><span><span className="sr-only">作者：</span>{item.author}</span></span>}
          <time dateTime={item.publishedAt??item.discoveredAt}><IconClock size={15}/><span><span className={item.publishedAt?"sr-only":undefined}>{item.publishedAt?"发布时间：":"收录时间："}</span>{readerDate(item.publishedAt??item.discoveredAt)}</span></time>
          <ArticleEngagementBar item={item} compact/>
        </div>
          {item.topics.length>0&&<nav aria-label="所属主题" className="article-topics">{item.topics.map(topic=><Link key={topic.slug} to={`/?${new URLSearchParams({topic:topic.slug})}`}>{topic.name}</Link>)}</nav>}
          <a href={item.links.original} target="_blank" rel="noreferrer" className="article-tool-link article-original-link text-accent">打开原文<IconExternal size={16}/></a>
        </div>
        {(metadata?.summary??item.summary)&&<p className="article-intro">{metadata?.summary??item.summary}</p>}
      </header>
      {html&&outline.length>0&&<div ref={reading.toolbar} className="article-reading-toolbar" data-reading-controls><MobileArticleOutline {...outlineProps}/></div>}
      {notices[item.bodyState.status]&&(item.bodyState.status!=='partial'||otherIssues.length>0||!figureIssues.length)&&<p className="article-status" role="status">{notices[item.bodyState.status]}</p>}
      {item.bodyState.refreshPending&&<p className="article-status">正文正在更新，当前显示已保存版本。</p>}
      <FigureNotice issues={figureIssues} onDismiss={()=>reading.scope.current?.querySelector<HTMLElement>('.floating-tools summary')?.focus({preventScroll:true})}/>
      {otherIssues.length>0&&<ul className="article-status list-disc pl-5">{otherIssues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul>}
      {translated&&!translated.complete&&<p className="article-status" role="status">译文尚不完整，未译段落保留原文；可打开原文对照。</p>}
      {html&&<div ref={reading.body} className="article-reading-body" role="region" aria-label="文章正文"><ArticleBody html={html}/></div>}
      {webModules().map(module=>module.articleTools?<module.articleTools key={module.name} articleId={item.id}/>:null)}
    </article>
  </ArticleLayout>
  <ArticleTools focus={focus} onFocus={()=>transitionAppearance(()=>{reading.preserve();setFocus(value=>!value);})} onBackToTop={reading.stop}/>
  </div></EngagementProvider>;}
