import {useState} from "react";
import {Link,useOutletContext} from "react-router";
import {OwnerRequestError,ownerRequest} from "../client.ts";
import type {ClassifiedArticle,LibraryFilters} from "../contracts.ts";

export default function ClassificationForm({article,categories,topics}:{article:ClassifiedArticle;categories:LibraryFilters["categories"];topics:LibraryFilters["topics"]}){
  const [current,setCurrent]=useState(article),[category,setCategory]=useState(article.category??"uncategorized"),[selected,setSelected]=useState(article.topicSlugs);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  const {expireSession}=useOutletContext<{expireSession:()=>void}>();
  const base="/api/admin/reader/articles/"+article.id;
  const dirty=category!==(current.category??"uncategorized")||selected.length!==current.topicSlugs.length||selected.some(slug=>!current.topicSlugs.includes(slug));
  const accept=(value:ClassifiedArticle)=>{setCurrent(value);setCategory(value.category??"uncategorized");setSelected(value.topicSlugs);};
  const command=async(work:()=>Promise<void>)=>{
    setBusy(true);setMessage("");setError("");
    try{await work();}catch(error){
      if(error instanceof OwnerRequestError&&error.status===401)expireSession();
      else setError(error instanceof OwnerRequestError&&error.status===409?"保存冲突：当前选择已保留，请重新载入分类与主题后再调整。":error instanceof Error?error.message:"保存失败");
    }finally{setBusy(false);}
  };
  return <form className="my-8 border-y border-line py-5" aria-label="文章分类与主题" aria-busy={busy} onSubmit={event=>{event.preventDefault();void command(async()=>{
    const value=await ownerRequest<ClassifiedArticle>(base+"/classification","PATCH",{expectedVersion:current.classificationVersion,category,topicSlugs:selected});accept(value);setMessage("分类与主题已保存");
  });}}><fieldset disabled={busy} className="min-w-0"><legend className="sr-only">文章分类与主题</legend>
    <div className="flex flex-wrap items-end gap-4"><label className="min-w-0 text-sm">文章分类<select name="category" value={category} onChange={event=>setCategory(event.target.value)} className="mt-1 block min-h-12 max-w-full rounded-control border border-line bg-surface px-3 text-base">{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><Link to="/admin/reader/categories" className="flex min-h-12 items-center text-accent underline">新增或改名</Link></div>
    <fieldset className="mt-5 min-w-0"><legend className="font-medium">技术主题（可多选）</legend><Link to="/admin/reader/topics" className="inline-flex min-h-12 items-center text-accent underline">新增或编辑主题</Link><div className="mt-2 grid gap-x-6 sm:grid-cols-2">{topics.map(topic=><label key={topic.slug} className="flex min-h-12 min-w-0 cursor-pointer items-center gap-3 py-2"><input type="checkbox" name="topicSlugs" value={topic.slug} checked={selected.includes(topic.slug)} onChange={event=>setSelected(event.target.checked?[...selected,topic.slug]:selected.filter(slug=>slug!==topic.slug))} className="size-4 shrink-0 accent-accent"/><span>{topic.name}</span></label>)}</div></fieldset>
    <p className="mt-2 text-sm text-ink-3">其他已有标签会保留。</p>
    {dirty&&<p className="mt-2 text-sm text-ink-3">分类与主题尚未保存</p>}
    <div className="mt-4 flex flex-wrap gap-3"><button type="submit" className="min-h-12 rounded-control bg-accent px-4 text-white disabled:opacity-50">{busy?"保存中…":"保存分类与主题"}</button><button type="button" className="min-h-12 rounded-control border border-line px-4 disabled:opacity-50" onClick={()=>void command(async()=>{const value=await ownerRequest<{article:ClassifiedArticle}>(base);accept(value.article);setMessage("分类与主题已重新载入");})}>重新载入分类与主题</button></div>
  </fieldset>{error&&<p role="alert" className="mt-3 text-hot">{error}</p>}{message&&!dirty&&<p role="status" className="mt-3">{message}</p>}</form>;
}
