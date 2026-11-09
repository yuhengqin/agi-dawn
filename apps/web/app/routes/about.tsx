import {SITE} from "@agidawn/site";
import {AboutContent} from "../components/shell/AboutContent";
import {PhoneBar} from "../components/shell/PhoneBar";
import {pageMeta} from "../lib/seo";
export const handle={tab:"me",name:"关于"};
export const headers=()=>({"Cache-Control":"no-store"});
export const shouldRevalidate=()=>true;
export const meta=()=>pageMeta({title:"关于",description:SITE.description,path:"/about"});
export default function About(){return <article className="mx-auto max-w-3xl pb-12">
  <PhoneBar title="关于"/><h1 className="pt-5 text-3xl font-semibold lg:pt-0">关于 {SITE.name}</h1>
  <AboutContent />
</article>;}
