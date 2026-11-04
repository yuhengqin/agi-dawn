import { data,redirect } from "react-router";
import { READER_PAGE_SIZES, type ReaderListPage, type TopicSummary } from "@agidawn/contracts/site";
import { beijingDate } from "@agidawn/contracts/time";
import { apiGet,loadOr404 } from "../../lib/api.server";

export interface ReaderSource { id:string;name:string;url:string|null;description:string|null;articles:number;fulltext:boolean;latestAt:string|null }
export type ReaderTopic=TopicSummary;
export interface ReaderPageData { page:ReaderListPage;sources:ReaderSource[];topics:ReaderTopic[];categories:Array<{id:string;name:string}>;query:Record<string,string>;latestArticleDate:string|null }

export async function loadReaderPage(request:Request) {
  const url=new URL(request.url);
  const params=new URLSearchParams();
  for(const [key,value] of url.searchParams) if(value.trim()) params.set(key,value.trim());
  if(params.toString()!==url.searchParams.toString())throw redirect(params.size?`/?${params}`:"/");
  const rawPage=params.get('page'),pageNumber=rawPage?Number(rawPage):null;
  if(rawPage!==null&&(!Number.isSafeInteger(pageNumber)||pageNumber!<1||pageNumber===1)){
    params.delete('page');throw redirect(params.size?`/?${params}`:'/');
  }
  const rawLimit=params.get('limit'),limitNumber=rawLimit?Number(rawLimit):null;
  if(rawLimit!==null&&(!Number.isSafeInteger(limitNumber)||!READER_PAGE_SIZES.includes(limitNumber as (typeof READER_PAGE_SIZES)[number]))){
    params.delete('limit');throw redirect(params.size?`/?${params}`:'/');
  }
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
  let latestArticleDate:string|null=null;
  if(page.total===0&&(params.has('from')||params.has('to'))){
    const undated=new URLSearchParams(params);
    for(const key of ['from','to','page'])undated.delete(key);
    undated.set('limit',String(READER_PAGE_SIZES[0]));
    try{
      const alternatives=await apiGet<ReaderListPage>(`/api/site/articles?${undated}`,{signal:request.signal});
      if(alternatives.items[0])latestArticleDate=beijingDate(alternatives.items[0].timelineAt);
    }catch(error){
      // A failed optional suggestion must not replace the successful empty result.
      if(request.signal.aborted)throw error;
    }
  }
  return data<ReaderPageData>({page,sources:sources.items,topics:topics.topics,categories:categories.items,query:Object.fromEntries(params),latestArticleDate},{headers:{"Cache-Control":"no-store"}});
}
export const readerHeaders=()=>({"Cache-Control":"no-store"});
