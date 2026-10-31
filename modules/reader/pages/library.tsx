import {Form,Link,useLoaderData,useNavigation,type LoaderFunctionArgs} from "react-router";
import {adminGet} from "../../../apps/web/app/lib/admin.server.ts";
import type {ReaderLibrary} from "../contracts.ts";
import {readerViewQueryKeys} from "../contracts.ts";
import LibraryOrganizer from "../components/LibraryOrganizer.tsx";
import SavedViews from "../components/SavedViews.tsx";
import LibraryDates from "../components/LibraryDates.tsx";
export const headers=()=>({"Cache-Control":"no-store"});
export const shouldRevalidate=()=>true;
export async function loader({request}:LoaderFunctionArgs){const query=new URLSearchParams(new URL(request.url).search);query.delete('_routes');query.delete('index');for(const [key,value] of [...query])if(!value.trim())query.delete(key);return {...await adminGet<ReaderLibrary>(request,"/api/admin/reader/library?"+query),query:Object.fromEntries(query)};}
const control="mt-1 block min-h-12 w-full min-w-0 rounded-control border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-accent";
export default function LibraryPage(){const page=useLoaderData<typeof loader>(),navigation=useNavigation(),busy=navigation.state!=="idle";
  const reviewQuery=new URLSearchParams(Object.fromEntries(readerViewQueryKeys.filter(key=>page.query[key]).map(key=>[key,page.query[key]!] )));reviewQuery.set('hasNote','true');reviewQuery.set('sort','note-updated');
  return <section className="mx-auto max-w-4xl px-5 py-8"><h1 className="text-2xl font-semibold">{page.query.hasNote==='true'&&page.query.sort==='note-updated'?'私人笔记回顾':'私人书库'}</h1>
  <Form key={JSON.stringify(page.query)} method="get" action="/admin/reader" className="my-6" aria-busy={busy}><fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3"><legend className="sr-only">筛选私人文章</legend>
    <div className="min-w-0 sm:col-span-2 lg:col-span-3"><label htmlFor="library-keywords" className="text-sm">关键词</label><input id="library-keywords" type="search" name="q" defaultValue={page.query.q??''} maxLength={200} enterKeyHint="search" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-describedby="library-search-help" className={control}/><p id="library-search-help" className="mt-2 text-sm text-ink-3">搜索标题、摘要、已保存正文和私人笔记。多个关键词用空格分隔，最多6个，均需命中。</p></div>
    <label className="min-w-0 text-sm">来源<select name="sourceId" defaultValue={page.query.sourceId??''} className={control}><option value="">全部来源</option>{page.filters.sources.map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
    <label className="min-w-0 text-sm">类别<select name="category" defaultValue={page.query.category??''} className={control}><option value="">全部类别</option>{page.filters.categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <label className="min-w-0 text-sm">主题<select name="topic" defaultValue={page.query.topic??''} className={control}><option value="">全部主题</option>{page.filters.topics.map(topic=><option key={topic.slug} value={topic.slug}>{topic.name}</option>)}</select></label>
    <label className="text-sm">收藏<select name="starred" defaultValue={page.query.starred??''} className={control}><option value="">全部</option><option value="true">已收藏</option><option value="false">未收藏</option></select></label>
    <label className="text-sm">阅读状态<select name="status" defaultValue={page.query.status??''} className={control}><option value="">全部</option><option value="to-read">待读</option><option value="reading">在读</option><option value="read">已读</option></select></label>
    <label className="text-sm">笔记<select name="hasNote" defaultValue={page.query.hasNote??''} className={control}><option value="">全部</option><option value="true">有笔记</option><option value="false">无笔记</option></select></label>
    <label className="text-sm">排序<select name="sort" defaultValue={page.query.sort??'collected'} className={control}><option value="collected">收录时间（从新到旧）</option><option value="note-updated">笔记最近更新</option></select></label>
    <LibraryDates query={page.query}/>
    <div className="flex items-end gap-4"><button type="submit" className="min-h-12 rounded-control bg-accent px-5 text-white disabled:opacity-50">{busy?'筛选中…':'筛选'}</button><Link to="/admin/reader" className="flex min-h-12 items-center text-accent underline">清除筛选</Link></div>
  </fieldset></Form>
  <SavedViews query={page.query} catalog={page.filters}/>
  <div className="mb-4 flex flex-wrap gap-x-6"><Link to={'/admin/reader?'+reviewQuery} className="inline-flex min-h-12 items-center text-accent underline">笔记回顾</Link><Link to="/admin/reader/topics" className="inline-flex min-h-12 items-center text-accent underline">管理主题</Link></div>
  <LibraryOrganizer key={"organizer:"+JSON.stringify(page.query)} items={page.items} filters={page.filters} navigating={busy}/>
  {page.nextCursor&&<Link className="mt-6 inline-block underline" to={"/admin/reader?"+new URLSearchParams({...page.query,cursor:page.nextCursor})}>{page.query.sort==='note-updated'?'下一页':'更早的文章'}</Link>}
</section>;}
