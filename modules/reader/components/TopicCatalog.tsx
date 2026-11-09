import {useEffect,useId,useRef,useState} from "react";
import {Link,useOutletContext} from "react-router";
import {OwnerRequestError,ownerRequest} from "../client.ts";
import type {ManagedTopic} from "../contracts.ts";
import {
  mergeTaxonomyCatalog,primaryTaxonomyButton,secondaryTaxonomyButton,taxonomyInput,
  useTaxonomyCommand,useTaxonomyDraft,type TrackTaxonomyDraft,
} from "./TaxonomyForms.ts";

export const topicCatalogPath="/api/admin/reader/topics";
const control=taxonomyInput+" mt-1 block w-full text-base";
type Refresh=()=>Promise<boolean>;

function TopicHeader({refresh,track}:{refresh:Refresh;track:TrackTaxonomyDraft}){
  const [open,setOpen]=useState(false),[name,setName]=useState(""),[definition,setDefinition]=useState("");
  const formId=useId(),input=useRef<HTMLInputElement>(null),command=useTaxonomyCommand(input);
  const dirty=name!==""||definition!=="";
  useTaxonomyDraft(track,formId,dirty);
  useEffect(()=>{if(open)input.current?.focus({preventScroll:true});},[open]);
  return <>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="topics" tabIndex={-1} className="scroll-mt-24 text-lg font-semibold lg:scroll-mt-6">主题</h2>
        <p className="mt-2 text-sm text-ink-3">主题可跨分类关联文章。改名和编辑说明会保留已有归属。</p>
      </div>
      <button type="button" aria-expanded={open} aria-controls={formId} className={open?secondaryTaxonomyButton:primaryTaxonomyButton}
        disabled={!!command.pending} onClick={()=>setOpen(!open)}>{open?"收起新增":dirty?"新增主题（有草稿）":"新增主题"}</button>
    </header>
    <form id={formId} hidden={!open} method="post" aria-label="新增主题" aria-busy={!!command.pending}
      className="mt-5 rounded-panel border border-line bg-surface p-4" onSubmit={event=>{
        event.preventDefault();
        void command.run("save",async()=>{
          await ownerRequest<ManagedTopic>(topicCatalogPath,"POST",{name,definition});
          setName("");setDefinition("");await refresh();
          return "主题已新增";
        });
      }}>
      <fieldset disabled={!!command.pending} className="min-w-0 space-y-3">
        <legend className="sr-only">新增主题</legend>
        <label className="block text-sm">主题名称<input ref={input} name="name" value={name}
          onChange={event=>{setName(event.target.value);command.clearFeedback();}} required maxLength={60} autoComplete="off" className={control}/></label>
        <label className="block text-sm">主题说明<textarea name="definition" value={definition}
          onChange={event=>{setDefinition(event.target.value);command.clearFeedback();}} required maxLength={2000} rows={3} className={control}/></label>
        <button type="submit" className={primaryTaxonomyButton}>{command.pending==="save"?"新增中…":"新增主题"}</button>
        {(command.error||command.pending==="read")&&<button type="button" className={secondaryTaxonomyButton+" ml-2"}
          onClick={()=>void command.run("read",async()=>await refresh()?"已刷新主题列表，输入已保留。":"")}>
          {command.pending==="read"?"核对中…":"核对主题列表"}
        </button>}
      </fieldset>
      {command.error&&<p role="alert" className="mt-2 text-sm text-hot">{command.error}</p>}
      {command.message&&<p role="status" className="mt-2 text-sm text-ink-3">{command.message}</p>}
    </form>
  </>;
}

function TopicRow({topic,refresh,track,onVersion}:{topic:ManagedTopic;refresh:Refresh;track:TrackTaxonomyDraft;onVersion:(value:ManagedTopic)=>void}){
  const [open,setOpen]=useState(false),[current,setCurrent]=useState(topic);
  const [name,setName]=useState(topic.name),[definition,setDefinition]=useState(topic.definition);
  const [comparison,setComparison]=useState<ManagedTopic|null>(null);
  const formId=useId(),headingId=useId(),input=useRef<HTMLInputElement>(null),command=useTaxonomyCommand(input);
  const dirty=name!==current.name||definition!==current.definition;
  const changed=name.trim()!==current.name||definition.trim()!==current.definition;
  useTaxonomyDraft(track,formId,dirty);
  const accept=(value:ManagedTopic)=>{setCurrent(value);setName(value.name);setDefinition(value.definition);};
  useEffect(()=>{if(!dirty&&topic.version>current.version)accept(topic);},[topic,current.version,dirty]);
  useEffect(()=>{if(open)input.current?.focus({preventScroll:true});},[open]);
  return <section aria-labelledby={headingId} className="min-w-0 px-4 py-3">
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 break-words">
        <h4 id={headingId} className="font-semibold">{topic.name}</h4>
        <p className="mt-1 whitespace-pre-wrap leading-relaxed text-ink-3">{topic.definition}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link aria-describedby={headingId} className="inline-flex min-h-9 items-center rounded-control px-2 text-sm text-accent underline"
          to={"/admin/reader?"+new URLSearchParams({topic:topic.slug})}>查看{topic.articleCount}篇文章</Link>
        <button type="button" aria-expanded={open} aria-controls={formId} aria-describedby={headingId} disabled={!!command.pending}
          className={secondaryTaxonomyButton} onClick={()=>setOpen(!open)}>{open?"收起编辑":"编辑主题"}</button>
      </div>
    </div>
    {!open&&dirty&&<p className="mt-1 text-sm text-ink-3">主题修改尚未保存</p>}
    <form id={formId} hidden={!open} method="post" aria-label={"编辑主题："+topic.name}
      aria-busy={!!command.pending} className="mt-3 border-t border-line pt-3" onSubmit={event=>{
        event.preventDefault();
        if(!changed)return;
        void command.run("save",async()=>{
          const value=await ownerRequest<ManagedTopic>(topicCatalogPath+"/"+encodeURIComponent(topic.slug),"PATCH",{name,definition,expectedVersion:current.version});
          accept(value);setComparison(null);onVersion(value);await refresh();
          return "主题已保存";
        });
      }}>
      <fieldset disabled={!!command.pending} className="min-w-0 space-y-3">
        <legend className="sr-only">编辑名称与说明</legend>
        <label className="block text-sm">主题名称<input ref={input} name="name" value={name}
          onChange={event=>{setName(event.target.value);command.clearFeedback();}} required maxLength={60} autoComplete="off" className={control}/></label>
        <label className="block text-sm">主题说明<textarea name="definition" value={definition}
          onChange={event=>{setDefinition(event.target.value);command.clearFeedback();}} required maxLength={2000} rows={3} className={control}/></label>
        {dirty&&<p className="text-sm text-ink-3">主题修改尚未保存</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!changed} className={primaryTaxonomyButton}>{command.pending==="save"?"保存中…":"保存主题"}</button>
          <button type="button" className={secondaryTaxonomyButton} onClick={()=>void command.run("read",async()=>{
            const {items}=await ownerRequest<{items:ManagedTopic[]}>(topicCatalogPath);
            const value=items.find(item=>item.slug===topic.slug);
            if(!value)throw new OwnerRequestError(404,"主题不存在");
            // Keep local changes only for fields the editor actually touched.
            setName(name.trim()===current.name?value.name:name);
            setDefinition(definition.trim()===current.definition?value.definition:definition);
            setCurrent(value);setComparison(value);onVersion(value);
            return "已核对，修改过的字段已保留。";
          })}>{command.pending==="read"?"核对中…":"核对已保存版本"}</button>
        </div>
      </fieldset>
      {command.error&&<p role="alert" className="mt-2 text-sm text-hot">{command.error}</p>}
      {command.message&&<p role="status" className="mt-2 text-sm text-ink-3">{command.message}</p>}
      {comparison&&<div className="mt-3 rounded-control bg-bg-sunk p-3 text-sm">
        <h5 className="font-semibold">已保存版本</h5>
        <p className="mt-1 break-words">{comparison.name}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-ink-3">{comparison.definition}</p>
        {changed&&<p className="mt-2 text-ink-3">保存后会以当前输入为准，请先核对差异。</p>}
      </div>}
    </form>
  </section>;
}

export function TopicCatalog({topics,track}:{topics:ManagedTopic[];track:TrackTaxonomyDraft}){
  const [items,setItems]=useState(topics);
  const [refreshError,setRefreshError]=useState(""),[refreshing,setRefreshing]=useState(false);
  const refreshId=useRef(0),{expireSession}=useOutletContext<{expireSession:()=>void}>();
  const updateCatalog=(snapshot:ManagedTopic[])=>setItems(current=>mergeTaxonomyCatalog(current,snapshot,item=>item.slug));
  useEffect(()=>{updateCatalog(topics);},[topics]);
  const onVersion=(value:ManagedTopic)=>setItems(current=>current.map(item=>item.slug===value.slug&&item.version<=value.version?value:item));
  const refresh=async()=>{
    const id=++refreshId.current;setRefreshing(true);
    try{
      const value=await ownerRequest<{items:ManagedTopic[]}>(topicCatalogPath);
      if(id===refreshId.current){updateCatalog(value.items);setRefreshError("");}
      return true;
    }catch(error){
      if(error instanceof OwnerRequestError&&error.status===401)expireSession();
      else if(id===refreshId.current)setRefreshError("主题列表刷新失败，当前列表和未保存输入已保留，请重试刷新。");
      return false;
    }finally{if(id===refreshId.current)setRefreshing(false);}
  };
  return <section aria-labelledby="topics" className="border-t border-line pt-6">
    <TopicHeader refresh={refresh} track={track}/>
    {refreshError&&<div aria-busy={refreshing} className="mt-4">
      <p role="alert" className="text-hot">{refreshError}</p>
      <button type="button" disabled={refreshing} className={secondaryTaxonomyButton+" mt-2"} onClick={()=>void refresh()}>
        {refreshing?"刷新中…":"重试刷新主题列表"}
      </button>
    </div>}
    <h3 className="mt-5 font-semibold">已有主题</h3>
    <p className="mb-3 mt-1 text-sm text-ink-3">关联篇数按私人书库统计，包含已下架文章和停用来源的历史。</p>
    <div className="divide-y divide-line rounded-panel border border-line bg-surface">
      {items.map(topic=><TopicRow key={topic.slug} topic={topic} refresh={refresh} track={track} onVersion={onVersion}/>)}
      {!items.length&&<p className="p-4">尚无主题，可以先新增一个。</p>}
    </div>
  </section>;
}
