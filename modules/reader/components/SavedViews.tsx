import {useEffect,useRef,useState} from "react";
import {Link,useOutletContext} from "react-router";
import {OwnerRequestError,ownerRequest} from "../client.ts";
import type {LibraryFilters,ReaderViewQuery,SavedReaderView} from "../contracts.ts";
import {readerViewQueryKeys as keys} from "../contracts.ts";

const base="/api/admin/reader/views";
const control="mt-1 block min-h-12 w-full min-w-0 rounded-control border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-accent";
const button="min-h-12 rounded-control border border-line px-4 disabled:opacity-50";
const primary="min-h-12 rounded-control bg-accent px-4 text-white disabled:opacity-50";
const statuses={"to-read":"待读",reading:"在读",read:"已读"};
function href(filters:ReaderViewQuery){const query=new URLSearchParams();for(const key of keys)if(filters[key])query.set(key,filters[key]!);return "/admin/reader"+(query.size?"?"+query:"");}
function description(q:ReaderViewQuery,catalog:LibraryFilters){return [q.q&&"关键词："+q.q,q.sourceId&&"来源："+(catalog.sources.find(s=>s.id===q.sourceId)?.name??q.sourceId),q.category&&"类别："+(catalog.categories.find(c=>c.id===q.category)?.name??q.category),q.topic&&"主题："+(catalog.topics.find(t=>t.slug===q.topic)?.name??q.topic),q.starred&&"收藏："+(q.starred==="true"?"已收藏":"未收藏"),q.status&&"阅读状态："+statuses[q.status],q.hasNote&&"笔记："+(q.hasNote==="true"?"有笔记":"无笔记"),q.sort==='note-updated'&&"排序：笔记最近更新",(q.dateFrom||q.dateTo)&&`${q.dateField==='note-updated'?'笔记更新':'收录'}日期（北京时间）：${q.dateFrom??'不限'} 至 ${q.dateTo??'不限'}`].filter(Boolean).join("；")||"全部文章";}
function missingReference(q:ReaderViewQuery,catalog:LibraryFilters){return [q.sourceId&&!catalog.sources.some(s=>s.id===q.sourceId)&&"来源已不存在",q.category&&!catalog.categories.some(c=>c.id===q.category)&&"类别已不存在",q.topic&&!catalog.topics.some(t=>t.slug===q.topic)&&"主题已不存在"].filter(Boolean).join("、");}
function useCommand(){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),running=useRef(false);
  const {expireSession}=useOutletContext<{expireSession:()=>void}>();
  const run=async(work:()=>Promise<string>)=>{
    if(running.current)return;running.current=true;setBusy(true);setError("");setMessage("");
    try{setMessage(await work());}catch(error){if(error instanceof OwnerRequestError&&error.status===401)expireSession();else setError(error instanceof OwnerRequestError?`${error.message}。输入已保留。`:"未能确认保存结果，输入已保留，请刷新视图列表核对后再操作。");}
    finally{running.current=false;setBusy(false);}
  };
  return {busy,error,message,run,clear:()=>{setError("");setMessage("");}};
}

function ViewEditor({item,applied,catalog,onChanged,onDeleted}:{item:SavedReaderView;applied:ReaderViewQuery;catalog:LibraryFilters;onChanged:(item:SavedReaderView)=>void;onDeleted:(id:string)=>void}){
  const [current,setCurrent]=useState(item),[name,setName]=useState(item.name),[confirmation,setConfirmation]=useState<"update"|"delete"|null>(null),command=useCommand();
  const dirty=name!==current.name,queryKey=JSON.stringify(applied),missing=missingReference(item.filters,catalog);
  const accept=(value:SavedReaderView,replaceName=true)=>{setCurrent(value);if(replaceName)setName(value.name);onChanged(value);};
  useEffect(()=>{if(!dirty&&!confirmation&&item.version>current.version){setCurrent(item);setName(item.name);}},[item,current.version,dirty,confirmation]);
  useEffect(()=>{setConfirmation(null);},[queryKey]);
  return <section aria-label={"视图："+item.name} className="min-w-0 py-4">
    {missing?<><h3 className="font-semibold">{item.name}</h3><p className="mt-2 text-sm text-hot">{missing}，请先用当前条件更新视图。</p></>:<h3><Link className="inline-flex min-h-12 items-center text-accent underline" aria-label={"打开视图："+item.name} to={href(item.filters)}>{item.name}</Link></h3>}
    <p className="mt-1 break-words text-sm leading-relaxed text-ink-3">{description(item.filters,catalog)}</p>
    <details className="mt-2"><summary className="min-h-12 cursor-pointer py-3 text-accent">管理视图</summary>
      <form method="post" action="/admin/reader" aria-label={"管理视图："+item.name} aria-busy={command.busy} onSubmit={event=>{event.preventDefault();void command.run(async()=>{const value=await ownerRequest<SavedReaderView>(base+"/"+current.id,"PATCH",{expectedVersion:current.version,name});accept(value);return "名称已保存";});}}>
        <fieldset disabled={command.busy} className="min-w-0 space-y-3"><legend className="sr-only">编辑常用视图</legend>
          <label className="block text-sm">视图名称<input name="name" required maxLength={60} autoComplete="off" value={name} onChange={event=>{setName(event.target.value);command.clear();}} className={control}/></label>
          {dirty&&<p className="text-sm text-ink-3">名称修改尚未保存</p>}
          <div className="flex flex-wrap gap-3"><button type="submit" disabled={!dirty} className={primary}>{command.busy?"保存中…":"保存名称"}</button><button type="button" className={button} onClick={()=>void command.run(async()=>{const value=await ownerRequest<SavedReaderView>(base+"/"+current.id);accept(value);setConfirmation(null);return "已载入已保存版本";})}>载入已保存版本</button></div>
          <div className="flex flex-wrap gap-3"><button type="button" className={button} onClick={()=>{setConfirmation("update");command.clear();}}>用当前条件更新</button><button type="button" className={button} onClick={()=>{setConfirmation("delete");command.clear();}}>删除视图</button></div>
          {confirmation==="update"&&<section aria-label="确认更新视图条件" className="space-y-3 border-y border-line py-4"><p>已保存条件：{description(current.filters,catalog)}</p><p>将替换为当前已应用条件：{description(applied,catalog)}</p><div className="flex flex-wrap gap-3"><button type="button" className={primary} onClick={()=>void command.run(async()=>{const value=await ownerRequest<SavedReaderView>(base+"/"+current.id,"PATCH",{expectedVersion:current.version,filters:applied});accept(value,!dirty);setConfirmation(null);return "条件已更新";})}>确认更新条件</button><button type="button" className={button} onClick={()=>setConfirmation(null)}>取消更新</button></div></section>}
          {confirmation==="delete"&&<section aria-label="确认删除视图" className="space-y-3 border-y border-line py-4"><p>删除“{current.name}”视图？文章、私人笔记、收藏和阅读状态均保留。</p><div className="flex flex-wrap gap-3"><button type="button" className={primary} onClick={()=>void command.run(async()=>{await ownerRequest(base+"/"+current.id,"DELETE",{expectedVersion:current.version});onDeleted(current.id);return "视图已删除";})}>确认删除</button><button type="button" className={button} onClick={()=>setConfirmation(null)}>取消删除</button></div></section>}
        </fieldset>
        {command.error&&<p role="alert" className="mt-3 text-hot">{command.error}</p>}{command.message&&<p role="status" className="mt-3">{command.message}</p>}
      </form>
    </details>
  </section>;
}

export default function SavedViews({query,catalog}:{query:Record<string,string>;catalog:LibraryFilters}){
  const applied=Object.fromEntries(keys.filter(key=>query[key]?.trim()&&!(key==='sort'&&query[key]==='collected')&&!(key==='dateField'&&(query[key]==='collected'||(!query.dateFrom&&!query.dateTo)))).map(key=>[key,query[key]])) as ReaderViewQuery;
  const [items,setItems]=useState<SavedReaderView[]>([]),[refreshing,setRefreshing]=useState(true),[loadError,setLoadError]=useState(""),[name,setName]=useState(""),[message,setMessage]=useState("");
  const requestId=useRef(0),pendingChanges=useRef(new Map<string,SavedReaderView|null>()),{expireSession}=useOutletContext<{expireSession:()=>void}>(),command=useCommand();
  const refresh=async()=>{
    const id=++requestId.current;pendingChanges.current.clear();setRefreshing(true);
    try{const value=await ownerRequest<{items:SavedReaderView[]}>(base);if(id===requestId.current){
      // A list response may describe the state before a completed local write.
      const rows=new Map(value.items.map(item=>[item.id,item]));
      for(const [key,item] of pendingChanges.current){if(item===null)rows.delete(key);else if(!rows.has(key)||rows.get(key)!.version<=item.version)rows.set(key,item);}
      pendingChanges.current.clear();setItems([...rows.values()]);setLoadError("");
    }}
    catch(error){if(error instanceof OwnerRequestError&&error.status===401)expireSession();else if(id===requestId.current)setLoadError("视图列表暂时无法加载，已有列表和输入已保留，文章仍可查询。请刷新视图列表重试。");}
    finally{if(id===requestId.current)setRefreshing(false);}
  };
  useEffect(()=>{void refresh();return()=>{requestId.current++;};},[]);
  const changed=(value:SavedReaderView)=>{pendingChanges.current.set(value.id,value);setMessage("");setItems(rows=>rows.some(row=>row.id===value.id)?rows.map(row=>row.id===value.id?value:row):[...rows,value]);};
  const deleted=(id:string)=>{pendingChanges.current.set(id,null);setItems(rows=>rows.filter(row=>row.id!==id));setMessage("视图已删除，文章及私人资料保留。");};
  return <section aria-label="常用视图" className="my-6 min-w-0 break-words border-y border-line py-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">常用视图</h2><button type="button" disabled={refreshing} className={button} onClick={()=>void refresh()}>{refreshing?"刷新中…":"刷新视图列表"}</button></div>
    <p className="mt-3 text-sm leading-relaxed text-ink-3">保存已点击“筛选”后生效的条件；不包含未应用的输入或分页。日期保存为固定起止值，不随每天移动。打开视图从第一页查询当前结果。</p>
    <p className="mt-2 text-sm leading-relaxed">当前已应用条件：{description(applied,catalog)}</p>
    {loadError&&<p role="alert" className="mt-3 text-hot">{loadError}</p>}
    <form method="post" action="/admin/reader" aria-label="保存常用视图" aria-busy={command.busy} className="my-4" onSubmit={event=>{event.preventDefault();void command.run(async()=>{const value=await ownerRequest<SavedReaderView>(base,"POST",{name,filters:applied});changed(value);setName("");return "视图已保存";});}}>
      <fieldset disabled={command.busy} className="min-w-0 space-y-3"><legend className="sr-only">保存当前已应用条件</legend><label className="block text-sm">视图名称<input name="name" required maxLength={60} autoComplete="off" value={name} onChange={event=>{setName(event.target.value);command.clear();}} className={control}/></label><button type="submit" className={primary}>{command.busy?"保存中…":"保存当前条件为视图"}</button></fieldset>
      {command.error&&<p role="alert" className="mt-3 text-hot">{command.error}</p>}{command.message&&!name&&<p role="status" className="mt-3">{command.message}</p>}
    </form>
    <div className="divide-y divide-line">{items.map(item=><ViewEditor key={item.id} item={item} applied={applied} catalog={catalog} onChanged={changed} onDeleted={deleted}/>)}</div>
    {!items.length&&!refreshing&&!loadError&&<p className="mt-3 text-sm text-ink-3">尚无常用视图，可以保存当前条件。</p>}{message&&<p role="status" className="mt-3">{message}</p>}
  </section>;
}
