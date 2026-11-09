import {useEffect} from "react";
import {Link,useLoaderData,useLocation,type LoaderFunctionArgs,type ShouldRevalidateFunction} from "react-router";
import {adminGet} from "../../../apps/web/app/lib/admin.server.ts";
import {CategoryCatalog,categoryCatalogPath,type Category} from "../components/CategoryCatalog.tsx";
import {TopicCatalog,topicCatalogPath} from "../components/TopicCatalog.tsx";
import {useTaxonomyDraftGuard} from "../components/TaxonomyForms.ts";
import type {ManagedTopic} from "../contracts.ts";

export const headers=()=>({"Cache-Control":"no-store"});
// Returning to the top of the page via browser history can clear the hash.
export const shouldRevalidate:ShouldRevalidateFunction=({currentUrl,nextUrl})=>
  currentUrl.pathname!==nextUrl.pathname||currentUrl.search!==nextUrl.search||currentUrl.hash===nextUrl.hash;
export async function loader({request}:LoaderFunctionArgs){
  const [categories,topics]=await Promise.all([
    adminGet<{items:Category[]}>(request,categoryCatalogPath),
    adminGet<{items:ManagedTopic[]}>(request,topicCatalogPath),
  ]);
  return {categories:categories.items,topics:topics.items};
}

export default function TaxonomyPage(){
  const {categories,topics}=useLoaderData<typeof loader>(),track=useTaxonomyDraftGuard();
  const {hash,key}=useLocation();
  useEffect(()=>{
    if(hash==="#categories"||hash==="#topics")document.getElementById(hash.slice(1))?.focus({preventScroll:true});
  },[hash,key]);
  return <div className="mx-auto max-w-4xl space-y-6 px-5 py-8">
    <header>
      <h1 className="text-2xl font-semibold">分类与主题管理</h1>
      <nav aria-label="管理区块" className="mt-2 flex flex-wrap gap-x-5">
        <Link to="#categories" className="inline-flex min-h-9 items-center text-accent underline">分类</Link>
        <Link to="#topics" className="inline-flex min-h-9 items-center text-accent underline">主题</Link>
      </nav>
    </header>
    <CategoryCatalog categories={categories} track={track}/>
    <TopicCatalog topics={topics} track={track}/>
  </div>;
}
