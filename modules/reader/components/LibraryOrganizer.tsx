import {useEffect,useRef,useState} from "react";
import {Link,useOutletContext,useRevalidator} from "react-router";
import {OwnerRequestError,ownerRequest} from "../client.ts";
import type {BulkClassificationPatch,BulkClassificationResult,BulkReaderStatePatch,BulkReaderStateResult,ReaderLibrary,ReaderState} from "../contracts.ts";
import {fullDateTime} from "../../../apps/web/app/lib/format.ts";
import NoteBatchExport from './NoteBatchExport.tsx';

const control="mt-1 block min-h-12 w-full min-w-0 rounded-control border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-accent";
const button="min-h-12 rounded-control border border-line px-4 disabled:opacity-50";
const matchLabels={title:"标题",summary:"摘要",body:"正文",note:"私人笔记"};
const statusLabels={'to-read':"待读",reading:"在读",read:"已读"};

export default function LibraryOrganizer({items,filters,navigating}:{items:ReaderLibrary["items"];filters:ReaderLibrary["filters"];navigating:boolean}){
  const [selected,setSelected]=useState<string[]>([]),[category,setCategory]=useState("");
  const [actions,setActions]=useState<Record<string,"add"|"remove"|"">>({}),[review,setReview]=useState(false);
  const [kind,setKind]=useState<"classification"|"state">("classification"),[starred,setStarred]=useState(""),[status,setStatus]=useState<ReaderState["status"]|"">("");
  const [saving,setSaving]=useState(false),[exporting,setExporting]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  const savingRef=useRef(false),selectAll=useRef<HTMLInputElement>(null);
  const {expireSession}=useOutletContext<{expireSession:()=>void}>(),revalidator=useRevalidator();
  const busy=saving||navigating||revalidator.state!=="idle",chosen=items.filter(item=>selected.includes(item.id));
  const additions=filters.topics.filter(topic=>actions[topic.slug]==="add"),removals=filters.topics.filter(topic=>actions[topic.slug]==="remove");
  const reset=()=>{setSelected([]);setCategory("");setActions({});setKind("classification");setStarred("");setStatus("");setReview(false);setError("");};
  // A refreshed result page must never retain hidden selections or old versions.
  useEffect(()=>{reset();},[items]);
  useEffect(()=>{if(selectAll.current)selectAll.current.indeterminate=chosen.length>0&&chosen.length<items.length;},[chosen.length,items.length]);
  const select=(ids:string[])=>{setSelected(ids);setReview(false);setError("");setMessage("");};
  const submit=async()=>{
    if(savingRef.current||busy||exporting)return;
    if(!chosen.length){setError("请先选择文章");return;}
    if(kind==="state"?!starred&&!status:!category&&!additions.length&&!removals.length){setError(kind==="state"?"请选择收藏或阅读状态操作":"请选择分类，或指定要添加、移除的主题");return;}
    if(!review){setError("");setReview(true);return;}
    const payload:BulkClassificationPatch|BulkReaderStatePatch=kind==="state"
      ?{articles:chosen.map(item=>({id:item.id,expectedVersion:item.state.version})),...(starred?{starred:starred==="true"}:{}),...(status?{status}:{})}
      :{articles:chosen.map(item=>({id:item.id,expectedVersion:item.classificationVersion})),...(category?{category:category==="uncategorized"?null:category}:{}),addTopicSlugs:additions.map(t=>t.slug),removeTopicSlugs:removals.map(t=>t.slug)};
    savingRef.current=true;setSaving(true);setMessage("");setError("");
    try{
      const result=await ownerRequest<BulkClassificationResult|BulkReaderStateResult>("/api/admin/reader/"+kind,"PATCH",payload);
      reset();setMessage(`已整理${result.selected}篇，其中${result.changed}篇有变更。列表已按原条件刷新。`);
      await revalidator.revalidate();
    }catch(error){
      if(error instanceof OwnerRequestError&&error.status===401)expireSession();
      else if(error instanceof OwnerRequestError)setError(error.status===409?"保存冲突，整批未保存。当前选择和操作已保留，请重新载入列表后再整理。":`整批未保存：${error.message}`);
      else setError("未能确认保存结果，请重新载入列表核对后再整理。");
    }finally{savingRef.current=false;setSaving(false);}
  };
  return <div aria-busy={busy}>
    {items.length>0&&<fieldset disabled={busy} className="min-w-0 border-y border-line py-3"><legend className="sr-only">选择本页文章</legend>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2"><label className="flex min-h-12 cursor-pointer items-center gap-3"><input ref={selectAll} type="checkbox" name="selectAll" checked={chosen.length===items.length} onChange={event=>select(event.target.checked?items.map(item=>item.id):[])} className="size-4 accent-accent"/>全选本页</label><span>已选{chosen.length}篇</span>{chosen.length>0&&<button type="button" className={button} onClick={()=>select([])}>取消选择</button>}</div>
      <p className="text-sm text-ink-3">仅整理本页所选文章，切换筛选、翻页或重载会清除选择。</p>
    </fieldset>}
    {chosen.length>0&&<NoteBatchExport ids={chosen.map(item=>item.id)} result={items} blocked={busy} onBusy={setExporting}/>}
    {chosen.length>0&&<form method="post" action="/admin/reader" aria-label="批量整理文章" className="my-5 border-b border-line pb-5" onSubmit={event=>{event.preventDefault();void submit();}}>
      <fieldset disabled={busy||exporting} className="min-w-0"><legend className="text-lg font-semibold">批量整理</legend>
        <div hidden={review}>
          <fieldset className="mt-4 min-w-0"><legend className="font-medium">整理内容</legend><div className="mt-1 flex flex-wrap gap-x-6 gap-y-2">{([{value:"classification",label:"分类与主题"},{value:"state",label:"收藏与阅读状态"}] as const).map(option=><label key={option.value} className="flex min-h-12 cursor-pointer items-center gap-3"><input type="radio" name="bulkKind" value={option.value} checked={kind===option.value} onChange={()=>{setKind(option.value);setError("");}} className="size-4 accent-accent"/>{option.label}</label>)}</div></fieldset>
          {kind==="classification"?<>
            <label className="mt-4 block text-sm">批量分类<select name="bulkCategory" value={category} onChange={event=>{setCategory(event.target.value);setError("");}} className={control}><option value="">不改变分类</option>{filters.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <fieldset className="mt-4 min-w-0"><legend className="font-medium">主题操作</legend><p className="mt-1 text-sm text-ink-3">每个主题可保留、添加或移除；其他已有标签保留。</p><div className="mt-3 grid gap-4 sm:grid-cols-2">{filters.topics.map(topic=><label key={topic.slug} className="min-w-0 text-sm">{topic.name}<select name={"topic-"+topic.slug} value={actions[topic.slug]??""} onChange={event=>{setActions({...actions,[topic.slug]:event.target.value as "add"|"remove"|""});setError("");}} className={control}><option value="">保留</option><option value="add">添加</option><option value="remove">移除</option></select></label>)}</div></fieldset>
          </>:<>
            <p className="mt-3 text-sm text-ink-3">收藏和阅读状态可分别保留或修改；私人笔记、分类、主题和正文保留。</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="min-w-0 text-sm">批量收藏<select name="bulkStarred" value={starred} onChange={event=>{setStarred(event.target.value);setError("");}} className={control}><option value="">保留收藏状态</option><option value="true">收藏</option><option value="false">取消收藏</option></select></label>
              <label className="min-w-0 text-sm">批量阅读状态<select name="bulkStatus" value={status} onChange={event=>{setStatus(event.target.value as ReaderState["status"]|"");setError("");}} className={control}><option value="">保留阅读状态</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            </div>
          </>}
        </div>
        {review&&<section aria-label="确认批量整理" className="mt-4 space-y-3"><h2 className="font-semibold">确认整理{chosen.length}篇文章</h2>
          {kind==="state"?<><p>收藏：{starred?starred==="true"?"收藏":"取消收藏":"保留"}</p><p>阅读状态：{status?statusLabels[status]:"保留"}</p></>:<><p>分类：{category?filters.categories.find(c=>c.id===category)?.name:"不改变"}</p><p>添加主题：{additions.map(t=>t.name).join("、")||"无"}</p><p>移除主题：{removals.map(t=>t.name).join("、")||"无"}</p></>}
          <ul className="list-disc space-y-1 break-words pl-5">{chosen.map(item=><li key={item.id}>{item.title}</li>)}</ul>
          <p className="text-sm text-ink-3">任一文章发生冲突，整批都不会保存。整理后，不再符合当前筛选的文章会移出列表。</p>
        </section>}
        <div className="mt-5 flex flex-wrap gap-3"><button type="submit" className="min-h-12 rounded-control bg-accent px-4 text-white disabled:opacity-50">{saving?"整理中…":review?`确认整理${chosen.length}篇`:"检查批量变更"}</button>{review&&<button type="button" className={button} onClick={()=>setReview(false)}>返回调整</button>}</div>
      </fieldset>
    </form>}
    {error&&<div className="my-4"><p role="alert" className="text-hot">{error}</p><button type="button" disabled={busy} className={button+" mt-3"} onClick={()=>{reset();setMessage("");void revalidator.revalidate();}}>重新载入列表并清除选择</button></div>}
    {message&&<p role="status" className="my-4">{message}</p>}
    <fieldset disabled={busy} className="min-w-0"><legend className="sr-only">筛选结果</legend><ol className="divide-y divide-line">{items.map(item=><li className="flex min-w-0 gap-3 py-4" key={item.id}>
      <label className="flex min-h-12 w-12 shrink-0 cursor-pointer items-start justify-center pt-2"><input type="checkbox" name="article" value={item.id} checked={selected.includes(item.id)} onChange={event=>select(event.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id))} className="size-4 accent-accent"/><span className="sr-only">选择 {item.title}</span></label>
      <div className="min-w-0 flex-1"><Link className="break-words text-lg text-accent" to={"/admin/reader/articles/"+item.id}>{item.title}</Link><p className="mt-1 text-sm text-ink-3">{item.source} · {statusLabels[item.state.status]} {item.state.starred?"· 已收藏":""} {item.withdrawn?"· 已下架":""}</p>
        {item.note&&<div className="mt-3 text-sm leading-relaxed"><p className="break-words"><span className="font-medium">{item.matches.some(match=>match.field==='note')?'私人笔记（命中关键词）':'已保存笔记'}：</span>{item.matches.find(match=>match.field==='note')?.snippet??item.note.snippet}</p><p className="mt-1 text-ink-3">笔记保存：<time dateTime={item.note.updatedAt}>{fullDateTime(item.note.updatedAt)}</time></p></div>}
        {item.matches.length>0&&<div className="mt-3 space-y-2 text-sm leading-relaxed">{item.matches.filter(match=>!item.note||match.field!=='note').map(match=><p key={match.field} className="break-words"><span className="font-medium">{matchLabels[match.field]}：</span>{match.snippet}</p>)}</div>}</div>
    </li>)}</ol></fieldset>
    {!items.length&&<p>没有符合条件的文章。</p>}
  </div>;
}
