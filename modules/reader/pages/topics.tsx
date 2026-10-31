import {useEffect,useRef,useState} from "react";
import {Link,useLoaderData,useOutletContext,type LoaderFunctionArgs} from "react-router";
import {adminGet} from "../../../apps/web/app/lib/admin.server.ts";
import {OwnerRequestError,ownerRequest} from "../client.ts";
import type {ManagedTopic} from "../contracts.ts";

export const headers=()=>({"Cache-Control":"no-store"});
export const shouldRevalidate=()=>true;
export async function loader({request}:LoaderFunctionArgs){return adminGet<{items:ManagedTopic[]}>(request,"/api/admin/reader/topics");}
const base="/api/admin/reader/topics";
const control="mt-1 block min-h-12 w-full min-w-0 rounded-control border border-line bg-surface px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-accent";
const button="min-h-12 rounded-control border border-line px-4 disabled:opacity-50";

function useCommand(){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const running=useRef(false),{expireSession}=useOutletContext<{expireSession:()=>void}>();
  const run=async(work:()=>Promise<string>)=>{
    if(running.current)return;running.current=true;setBusy(true);setError("");setMessage("");
    try{setMessage(await work());}catch(error){
      if(error instanceof OwnerRequestError&&error.status===401)expireSession();
      else setError(error instanceof OwnerRequestError?`${error.message}。输入已保留。`:"未能确认保存结果，输入已保留，请重新载入核对。");
    }finally{running.current=false;setBusy(false);}
  };
  return {busy,error,message,run,clearError:()=>setError("")};
}

function NewTopic({refresh}:{refresh:()=>Promise<void>}){
  const [name,setName]=useState(""),[definition,setDefinition]=useState(""),command=useCommand();
  return <form method="post" action="/admin/reader/topics" aria-label="新增主题" aria-busy={command.busy} className="my-6 border-y border-line py-5" onSubmit={event=>{event.preventDefault();void command.run(async()=>{
    await ownerRequest<ManagedTopic>(base,"POST",{name,definition});setName("");setDefinition("");await refresh();return "主题已新增";
  });}}><fieldset disabled={command.busy} className="min-w-0 space-y-4"><legend className="mb-3 text-lg font-semibold">新增主题</legend>
    <label className="block text-sm">主题名称<input name="name" value={name} onChange={event=>{setName(event.target.value);command.clearError();}} required maxLength={60} autoComplete="off" className={control}/></label>
    <label className="block text-sm">主题说明<textarea name="definition" value={definition} onChange={event=>{setDefinition(event.target.value);command.clearError();}} required maxLength={2000} rows={3} className={control}/></label>
    <button type="submit" className="min-h-12 rounded-control bg-accent px-4 text-white disabled:opacity-50">{command.busy?"新增中…":"新增主题"}</button>
  </fieldset>{command.error&&<p role="alert" className="mt-3 text-hot">{command.error}</p>}{command.message&&!name&&!definition&&<p role="status" className="mt-3">{command.message}</p>}</form>;
}

function TopicEditor({topic,refresh}:{topic:ManagedTopic;refresh:()=>Promise<void>}){
  const [current,setCurrent]=useState(topic),[name,setName]=useState(topic.name),[definition,setDefinition]=useState(topic.definition),command=useCommand();
  const dirty=name!==current.name||definition!==current.definition;
  const accept=(value:ManagedTopic)=>{setCurrent(value);setName(value.name);setDefinition(value.definition);};
  useEffect(()=>{if(!dirty&&topic.version>current.version)accept(topic);},[topic,current.version,dirty]);
  return <form method="post" action="/admin/reader/topics" aria-label={"编辑主题："+topic.name} aria-busy={command.busy} className="pb-4" onSubmit={event=>{event.preventDefault();void command.run(async()=>{
    const value=await ownerRequest<ManagedTopic>(base+"/"+encodeURIComponent(topic.slug),"PATCH",{name,definition,expectedVersion:current.version});accept(value);await refresh();return "主题已保存";
  });}}><fieldset disabled={command.busy} className="min-w-0 space-y-4"><legend className="sr-only">编辑名称与说明</legend>
    <label className="block text-sm">主题名称<input name="name" value={name} onChange={event=>{setName(event.target.value);command.clearError();}} required maxLength={60} autoComplete="off" className={control}/></label>
    <label className="block text-sm">主题说明<textarea name="definition" value={definition} onChange={event=>{setDefinition(event.target.value);command.clearError();}} required maxLength={2000} rows={3} className={control}/></label>
    {dirty&&<p className="text-sm text-ink-3">主题修改尚未保存</p>}
    <div className="flex flex-wrap gap-3"><button type="submit" disabled={!dirty} className="min-h-12 rounded-control bg-accent px-4 text-white disabled:opacity-50">{command.busy?"保存中…":"保存主题"}</button><button type="button" className={button} onClick={()=>void command.run(async()=>{
      const {items}=await ownerRequest<{items:ManagedTopic[]}>(base),value=items.find(t=>t.slug===topic.slug);if(!value)throw new OwnerRequestError(404,"主题不存在");accept(value);await refresh();return "已载入已保存版本";
    })}>载入已保存版本</button></div>
  </fieldset>{command.error&&<p role="alert" className="mt-3 text-hot">{command.error}</p>}{command.message&&!dirty&&<p role="status" className="mt-3">{command.message}</p>}</form>;
}

export default function TopicsPage(){
  const loaded=useLoaderData<typeof loader>(),[items,setItems]=useState(loaded.items),[refreshError,setRefreshError]=useState(""),[refreshing,setRefreshing]=useState(false);
  const refreshId=useRef(0),{expireSession}=useOutletContext<{expireSession:()=>void}>();
  useEffect(()=>{setItems(loaded.items);},[loaded.items]);
  const refresh=async()=>{
    const id=++refreshId.current;setRefreshing(true);
    try{const value=await ownerRequest<{items:ManagedTopic[]}>(base);if(id===refreshId.current){setItems(value.items);setRefreshError("");}}
    catch(error){if(error instanceof OwnerRequestError&&error.status===401)expireSession();else if(id===refreshId.current)setRefreshError("主题列表刷新失败，当前列表和未保存输入已保留。已保存的修改不受影响，请重试刷新。");}
    finally{if(id===refreshId.current)setRefreshing(false);}
  };
  return <section className="mx-auto max-w-3xl break-words px-5 py-8"><h1 className="text-2xl font-semibold">主题管理</h1>
    <p className="mt-3 text-sm leading-relaxed text-ink-3">主题可以跨分类关联文章。改名和编辑说明会保留已有归属；新增后可在筛选、文章勾选和批量整理中使用。</p>
    {refreshError&&<div aria-busy={refreshing} className="mt-4"><p role="alert" className="text-hot">{refreshError}</p><button type="button" disabled={refreshing} className={button+" mt-3"} onClick={()=>void refresh()}>{refreshing?"刷新中…":"重试刷新主题列表"}</button></div>}
    <NewTopic refresh={refresh}/>
    <h2 className="text-lg font-semibold">已有主题</h2><p className="mt-2 text-sm text-ink-3">关联篇数按私人书库统计，包含已下架文章和停用来源的历史。</p>
    <div className="mt-3 divide-y divide-line">{items.map(topic=><section key={topic.slug} aria-label={topic.name} className="min-w-0 py-5"><h3 className="font-semibold">{topic.name}</h3><p className="mt-2 whitespace-pre-wrap leading-relaxed text-ink-3">{topic.definition}</p><Link className="mt-2 inline-flex min-h-12 items-center text-accent underline" to={"/admin/reader?"+new URLSearchParams({topic:topic.slug})}>查看{topic.articleCount}篇文章</Link>
      <details className="mt-1"><summary className="min-h-12 cursor-pointer py-3 text-accent">编辑主题</summary><TopicEditor topic={topic} refresh={refresh}/></details>
    </section>)}</div>{!items.length&&<p className="my-5">尚无主题，可以先新增一个。</p>}
  </section>;
}
