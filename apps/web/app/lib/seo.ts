import type {MetaDescriptor} from "react-router";
import {SITE} from "@agidawn/site";

export function siteUrl():string {
  return typeof window!=="undefined"?window.location.origin:(process.env.SITE_URL||SITE.defaultUrl).replace(/\/+$/,"");
}
export const titled=(title:string)=>`${title} · ${SITE.name}`;
export function listPath(path:string,params:Record<string,string|number|null|undefined>):string {
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(params))if(value!==null&&value!==undefined&&value!=="")query.set(key,String(value));
  return query.size?`${path}?${query}`:path;
}
export interface PageMetaInput {
  title?:string|null;rawTitle?:boolean;description?:string|null;path:string;image?:string|null;
  noindex?:boolean;nofollow?:boolean;type?:"website"|"article";jsonLd?:Record<string,unknown>|Array<Record<string,unknown>>;
}
export function pageMeta(input:PageMetaInput):MetaDescriptor[]{
  const base=siteUrl(),title=input.title?(input.rawTitle?input.title:titled(input.title)):SITE.homeTitle;
  const description=input.description??SITE.description,url=base+input.path,image=new URL(input.image||"/og/site.png",base).href;
  const tags:MetaDescriptor[]=[{title},{name:"description",content:description},{tagName:"link",rel:"canonical",href:url},
    {property:"og:site_name",content:SITE.name},{property:"og:type",content:input.type??"website"},{property:"og:title",content:input.title??SITE.homeTitle},
    {property:"og:description",content:description},{property:"og:url",content:url},{property:"og:image",content:image},
    {property:"og:locale",content:SITE.locale.replace("-","_")},{name:"twitter:card",content:"summary_large_image"},
    {name:"twitter:title",content:input.title??SITE.homeTitle},{name:"twitter:description",content:description},{name:"twitter:image",content:image}];
  if(input.noindex)tags.push({name:"robots",content:input.nofollow?"noindex, nofollow":"noindex, follow"});
  if(input.jsonLd)tags.push({"script:ld+json":input.jsonLd});
  return tags;
}
