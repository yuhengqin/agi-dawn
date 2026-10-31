import {data,Link,useLoaderData} from "react-router";
import {SITE} from "@agidawn/site";
import type {TopicSummary,TopicsResponse} from "@agidawn/contracts/site";
import type {Route} from "./+types/explore";
import {loadOr404} from "../lib/api.server";
import type {ReaderSource} from "../features/feed/reader.server";
import {PhoneBar} from "../components/shell/PhoneBar";
import {IconChevronRight} from "../components/icons";
import {fullDateTime,relativeTime} from "../lib/format";
import {pageMeta} from "../lib/seo";
export {readerHeaders as headers} from "../features/feed/reader.server";
export const handle={tab:"explore",name:"探索"};
export const meta=({loaderData}:Route.MetaArgs)=>pageMeta({title:SITE.exploreTitle,path:loaderData?.view==="sources"?"/explore?view=sources":"/explore",image:"/og/pages/explore.png"});
export async function loader({request}:Route.LoaderArgs){
  const view=new URL(request.url).searchParams.get("view")==="sources"?"sources":"topics";
  const [topics,sources]=await Promise.all([
    loadOr404<TopicsResponse>("/api/site/topics",{signal:request.signal}),
    loadOr404<{items:ReaderSource[]}>("/api/site/sources",{signal:request.signal}),
  ]);
  return data({view,topics:topics.topics,sources:sources.items},{headers:{"Cache-Control":"no-store"}});
}

const card="group flex h-full items-center gap-3 py-4 transition-colors active:bg-bg-sunk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:card lg:card-hover lg:items-stretch lg:px-5 lg:py-4";
function UpdatedAt({at}:{at:string}){
  return <p className="mt-1.5"><time dateTime={at} title={fullDateTime(at)} suppressHydrationWarning>{relativeTime(at)}</time> 更新</p>;
}
function TopicCard({topic}:{topic:TopicSummary}){
  return <Link to={`/?${new URLSearchParams({topic:topic.slug})}`} aria-labelledby={`topic-${topic.slug}`} className={card}>
    <article className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
      <h2 id={`topic-${topic.slug}`} className="text-[16px] font-semibold text-ink group-hover:text-accent">{topic.name}</h2>
      <p className="mt-1.5 line-clamp-2 flex-1 text-[13px] leading-relaxed text-ink-2">{topic.latest?.title??topic.definition}</p>
      <footer className="mt-3 text-[12px] text-ink-3">
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span>{topic.total.toLocaleString("zh-CN")} 篇文章</span><span>近 30 天 {topic.recent.toLocaleString("zh-CN")} 篇</span></div>
        {topic.latest?<UpdatedAt at={topic.latest.at}/>:<p className="mt-1.5">暂无文章</p>}
      </footer>
    </article>
    <IconChevronRight size={16} className="shrink-0 text-ink-4 lg:hidden"/>
  </Link>;
}
function SourceCard({source}:{source:ReaderSource}){
  return <Link to={`/?${new URLSearchParams({sourceId:source.id})}`} aria-labelledby={`source-${source.id}`} className={card}>
    <article className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
      <h2 id={`source-${source.id}`} className="text-[16px] font-semibold text-ink group-hover:text-accent">{source.name}</h2>
      {(source.description||source.url)&&<p className="mt-1.5 line-clamp-2 flex-1 text-[13px] leading-relaxed text-ink-2">{source.description||source.url}</p>}
      <footer className="mt-3 text-[12px] text-ink-3"><p>{source.articles.toLocaleString("zh-CN")} 篇已收录文章</p>
        {source.latestAt&&<UpdatedAt at={source.latestAt}/>}</footer>
    </article>
    <IconChevronRight size={16} className="shrink-0 text-ink-4 lg:hidden"/>
  </Link>;
}

export default function Explore(){
  const {view,topics,sources}=useLoaderData<typeof loader>(),bySource=view==="sources";
  return <section className="pb-12"><PhoneBar title="探索"/>
    <header className="pt-5 lg:pt-0"><h1 data-page-title className="text-2xl font-semibold text-ink">{SITE.exploreTitle}</h1>
      <p className="mt-2 text-sm text-ink-3">按技术主题或内容来源发现文章，查看最新收录与更新。</p></header>
    <nav aria-label="探索方式" className="mt-6 flex gap-6 border-b border-line">
      {[{view:"topics",to:"/explore",name:"主题",count:topics.length},{view:"sources",to:"/explore?view=sources",name:"来源",count:sources.length}].map(option=><Link key={option.view} to={option.to} aria-current={view===option.view?"page":undefined}
        className="inline-flex min-h-11 items-center gap-2 border-b-2 border-transparent px-1 text-sm text-ink-3 aria-[current=page]:border-accent aria-[current=page]:font-semibold aria-[current=page]:text-accent focus-visible:outline-2 focus-visible:outline-accent">{option.name}<span aria-hidden="true" className="text-[12px]">{option.count}</span></Link>)}
    </nav>
    <h2 className="sr-only">{bySource?"来源目录":"技术主题"}</h2>
    {!(bySource?sources.length:topics.length)&&<p className="py-8 text-ink-3">{bySource?"尚未收录来源文章。":"主题将随文章积累逐步整理。现在可以按来源和日期查找文章。"}</p>}
    <ul className="mt-4 divide-y divide-line lg:grid lg:grid-cols-3 lg:gap-3 lg:divide-y-0 xl:grid-cols-4">{bySource?sources.map(source=><li className="min-w-0" key={source.id}><SourceCard source={source}/></li>):topics.map(topic=><li className="min-w-0" key={topic.slug}><TopicCard topic={topic}/></li>)}</ul>
  </section>;
}
