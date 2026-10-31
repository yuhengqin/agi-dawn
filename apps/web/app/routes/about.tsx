import {Link} from "react-router";
import {ABOUT,SITE} from "@agidawn/site";
import {PhoneBar} from "../components/shell/PhoneBar";
import {pageMeta} from "../lib/seo";
export const handle={tab:"me",name:"关于"};
export const headers=()=>({"Cache-Control":"no-store"});
export const shouldRevalidate=()=>true;
export const meta=()=>pageMeta({title:"关于",description:SITE.description,path:"/about"});
export default function About(){return <article className="mx-auto max-w-3xl pb-12">
  <PhoneBar title="关于"/><h1 className="pt-5 text-3xl font-semibold lg:pt-0">关于 {SITE.name}</h1>
  <p className="my-6 text-lg leading-relaxed text-ink-2">{SITE.description}</p>
  <section className="space-y-7 border-y border-line py-6">{[["收录",ABOUT.steps.collect],["阅读",ABOUT.steps.store],["查找",ABOUT.steps.select],["保存",ABOUT.steps.publish]].map(([title,text])=><div key={title}><h2 className="text-xl font-semibold">{title}</h2><p className="mt-2 leading-relaxed text-ink-2">{text}</p></div>)}</section>
  <p className="my-6 leading-relaxed text-ink-3">原文版权归各来源所有，全文展示以来源许可为准。站主的收藏、阅读状态和笔记只对站主本人开放。</p>
  <div className="flex flex-wrap gap-6 text-accent"><Link to="/explore?view=sources">查看来源</Link><Link to="/feedback">更正与反馈</Link><Link to="/admin/reader">站主空间</Link></div>
</article>;}
