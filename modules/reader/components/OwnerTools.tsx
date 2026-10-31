import {useEffect,useRef,useState} from "react";
import {Link,useBlocker} from "react-router";
import {OwnerRequestError,ownerMe,ownerRequest,ownerDownload} from "../client.ts";
import type {ReaderState,ReaderNote} from "../contracts.ts";
const button="min-h-11 rounded-control border border-line px-4 text-sm hover:bg-bg-sunk disabled:opacity-50";
export default function OwnerTools({articleId}:{articleId:string}) {
  const [saved,setSaved]=useState<{state:ReaderState;note:ReaderNote}|null>(null),[draft,setDraft]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState("");
  const [checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[serverNote,setServerNote]=useState<string|null>(null);
  const base="/api/admin/reader/articles/"+articleId;
  const downloadUrl=useRef<string|null>(null),generation=useRef(0);
  const invalidateDownload=()=>{generation.current++;if(downloadUrl.current){URL.revokeObjectURL(downloadUrl.current);downloadUrl.current=null;}};
  const clear=()=>{invalidateDownload();setSaved(null);setDraft('');setServerNote(null);setMessage('');setError('');};
  useEffect(()=>()=>invalidateDownload(),[articleId]);
  const dirty=!!saved&&draft!==saved.note.text;
  const blocker=useBlocker(({currentLocation,nextLocation})=>dirty&&(currentLocation.pathname!==nextLocation.pathname||currentLocation.search!==nextLocation.search));
  useEffect(()=>{if(blocker.state==='blocked'){if(dirty&&window.confirm('笔记尚未保存，确定放弃草稿并离开？'))blocker.proceed();else blocker.reset();}},[blocker,dirty]);
  useEffect(()=>{if(!dirty)return;const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[dirty]);
  useEffect(()=>{
    let active=true;const abort=new AbortController();
    clear();setChecking(true);const started=generation.current;
    ownerRequest<{state:ReaderState;note:ReaderNote}>(base).then(value=>{if(active&&started===generation.current){setSaved(value);setDraft(value.note.text);}}).catch(error=>{if(active&&!(error instanceof OwnerRequestError&&error.status===401))setError("私人空间暂不可用");}).finally(()=>{if(active)setChecking(false);});
    const verify=async()=>{if(document.visibilityState==="hidden")return;setChecking(true);try{await ownerMe(abort.signal);}catch(error){if(active&&error instanceof OwnerRequestError&&error.status===401)clear();}finally{if(active)setChecking(false);}};
    window.addEventListener("focus",verify);window.addEventListener("pageshow",verify);document.addEventListener("visibilitychange",verify);
    return()=>{active=false;abort.abort();window.removeEventListener("focus",verify);window.removeEventListener("pageshow",verify);document.removeEventListener("visibilitychange",verify);};
  },[base]);
  const command=async(work:()=>Promise<void>)=>{
    setBusy(true);setError("");setMessage("");
    try{await work();}catch(error){if(error instanceof OwnerRequestError&&error.status===401)clear();
      else setError(error instanceof OwnerRequestError&&error.status===409?"保存冲突：草稿已保留，请载入服务端版本对照后再保存。":error instanceof Error?error.message:"请求失败");}
    finally{setBusy(false);}
  };
  if(!saved||checking)return null;
  const state=saved.state;
  return <section aria-label="站主私人阅读" className="my-8 border-y border-line py-5">
    <div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="mr-auto text-lg font-semibold">私人阅读</h2><Link to="/admin/reader" className="text-sm text-accent">私人书库</Link><Link to={"/admin/reader/articles/"+articleId} className="text-sm text-accent">私人阅读全文</Link><Link to={"/admin/reader/articles/"+articleId+'#versions'} className="text-sm text-accent">归档版本</Link></div>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <button className={button} disabled={busy} aria-pressed={state.starred} onClick={()=>command(async()=>{const next=await ownerRequest<ReaderState>(base+"/state","PATCH",{expectedVersion:state.version,starred:!state.starred});setSaved({...saved,state:next});})}>{state.starred?"取消收藏":"收藏文章"}</button>
      <label>阅读状态 <select aria-label="阅读状态" className={button} disabled={busy} value={state.status} onChange={event=>{const status=event.target.value;void command(async()=>{const next=await ownerRequest<ReaderState>(base+"/state","PATCH",{expectedVersion:state.version,status});setSaved({...saved,state:next});});}}>
        <option value="to-read">待读</option><option value="reading">在读</option><option value="read">已读</option></select></label>
    </div>
    <label className="block text-sm">私人笔记<textarea className="mt-2 block min-h-36 w-full rounded-control border border-line bg-surface p-3 text-base" maxLength={20000} value={draft} onChange={event=>setDraft(event.target.value)}/></label>
    {dirty&&<p className="mt-2 text-sm text-ink-3">笔记尚未保存</p>}
    <div className="mt-3 flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={()=>command(async()=>{const note=await ownerRequest<ReaderNote>(base+"/note","PUT",{expectedVersion:saved.note.version,text:draft});setSaved({...saved,note});setServerNote(null);setMessage("笔记已保存");})}>保存笔记</button>
      <button className={button} disabled={busy} onClick={()=>command(async()=>{const fresh=await ownerRequest<{state:ReaderState;note:ReaderNote}>(base);setSaved(fresh);setServerNote(fresh.note.text);setMessage("已载入服务端版本，当前草稿保持不变。");})}>载入服务端版本</button>
      <button className={button} disabled={busy} onClick={()=>command(async()=>{const started=generation.current,blob=await ownerDownload(base+'/note.md');if(started!==generation.current)return;if(downloadUrl.current)URL.revokeObjectURL(downloadUrl.current);downloadUrl.current=URL.createObjectURL(blob);const link=document.createElement('a');link.href=downloadUrl.current;link.download='reading-note-'+articleId.replace(/[^\w-]/g,'_')+'.md';link.click();setMessage('已导出服务端保存的笔记');})}>导出笔记 Markdown</button></div>
    {dirty&&<p className="mt-2 text-sm text-ink-3">仅导出已保存笔记，当前草稿不会写入文件。</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-hot">{error}</p>}{message&&<p role="status" className="mt-3 text-sm text-ink-3">{message}</p>}
    {serverNote!==null&&<div className="mt-4"><h3 className="text-sm font-medium">服务端笔记</h3><p className="my-2 whitespace-pre-wrap text-sm text-ink-3">{serverNote||"（空）"}</p><button className={button} onClick={()=>setDraft(serverNote)}>采用服务端笔记</button></div>}
  </section>;
}
