import { data,redirect } from "react-router";
import type { ReaderListPage,TopicSummary } from "@agidawn/contracts/site";
import { loadOr404 } from "../../lib/api.server";

export interface ReaderSource { id:string;name:string;url:string|null;description:string|null;articles:number;fulltext:boolean;latestAt:string|null }
export type ReaderTopic=TopicSummary;
export interface ReaderPageData { page:ReaderListPage;sources:ReaderSource[];topics:ReaderTopic[];categories:Array<{id:string;name:string}>;query:Record<string,string> }

export async function loadReaderPage(request:Request) {
  const url=new URL(request.url);
  const params=new URLSearchParams();
  for(const [key,value] of url.searchParams) if(value.trim()) params.set(key,value.trim());
  if(params.toString()!==url.searchParams.toString())throw redirect(params.size?`/?${params}`:"/");
  const [page,sources,topics,categories]=await Promise.all([
    loadOr404<ReaderListPage>(`/api/site/articles?${params}`,{signal:request.signal}),
    loadOr404<{items:ReaderSource[]}>("/api/site/sources",{signal:request.signal}),
    loadOr404<{topics:ReaderTopic[]}>("/api/site/topics",{signal:request.signal}),
    loadOr404<{items:Array<{id:string;name:string}>}>("/api/site/categories",{signal:request.signal}),
  ]);
  if(Number(params.get('page')??1)!==page.page){
    if(page.page===1)params.delete('page');else params.set('page',String(page.page));
    throw redirect(params.size?`/?${params}`:'/');
  }
  return data<ReaderPageData>({page,sources:sources.items,topics:topics.topics,categories:categories.items,query:Object.fromEntries(params)},{headers:{"Cache-Control":"no-store"}});
}
export const readerHeaders=()=>({"Cache-Control":"no-store"});
