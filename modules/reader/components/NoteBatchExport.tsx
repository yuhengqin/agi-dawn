import {useLayoutEffect,useRef,useState} from 'react';
import {useOutletContext} from 'react-router';
import {ownerDownload,OwnerRequestError} from '../client.ts';
import type {ReaderLibrary} from '../contracts.ts';

export default function NoteBatchExport({ids,result,blocked,onBusy}:{ids:string[];result:ReaderLibrary['items'];blocked:boolean;onBusy:(value:boolean)=>void}){
  const [running,setRunning]=useState(false),[leaving,setLeaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const pending=useRef<AbortController|null>(null),generation=useRef(0),departing=useRef(false),url=useRef<string|null>(null),key=JSON.stringify(ids);
  const {expireSession}=useOutletContext<{expireSession:()=>void}>();
  const invalidate=()=>{generation.current++;pending.current?.abort();pending.current=null;if(url.current){URL.revokeObjectURL(url.current);url.current=null;}};
  // Invalidate before a changed selection/result can accept a late private response.
  useLayoutEffect(()=>{
    invalidate();setRunning(false);onBusy(false);setError('');setMessage('');
    return()=>{invalidate();onBusy(false);};
  },[key,result,blocked,onBusy]);
  useLayoutEffect(()=>{
    const cancel=()=>{invalidate();setRunning(false);onBusy(false);};
    // Native logout keeps this document alive until its POST redirect arrives.
    const logout=(event:SubmitEvent)=>{const form=event.target;if(form instanceof HTMLFormElement&&form.method.toLowerCase()==='post'&&new URL(form.action).origin===location.origin&&new URL(form.action).pathname==='/api/auth/logout'){departing.current=true;setLeaving(true);cancel();}};
    document.addEventListener('submit',logout,true);window.addEventListener('pagehide',cancel);
    return()=>{document.removeEventListener('submit',logout,true);window.removeEventListener('pagehide',cancel);};
  },[onBusy]);
  const download=async()=>{
    if(blocked||departing.current||pending.current||!ids.length)return;
    invalidate();const started=generation.current,abort=new AbortController();pending.current=abort;setRunning(true);onBusy(true);setError('');setMessage('');
    try{
      const blob=await ownerDownload('/api/admin/reader/notes/export.zip','POST',{articleIds:ids},{signal:abort.signal});
      if(abort.signal.aborted||started!==generation.current)return;
      url.current=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url.current;link.download='reading-notes.zip';link.click();setMessage(`已导出${ids.length}篇文章的已保存笔记。`);
    }catch(error){
      if(error instanceof OwnerRequestError&&error.status===401)expireSession();
      else if(!abort.signal.aborted&&started===generation.current)setError(error instanceof OwnerRequestError?`导出失败：${error.message}。选择和整理草稿已保留。`:'导出失败，请重试。选择和整理草稿已保留。');
    }finally{if(started===generation.current){pending.current=null;setRunning(false);onBusy(false);}}
  };
  return <section aria-label="批量导出笔记" aria-busy={running} className="my-4 min-w-0">
    <button type="button" disabled={blocked||running||leaving} className="min-h-12 rounded-control border border-line px-4 disabled:opacity-50" onClick={()=>void download()}>{running?'导出中…':'导出所选笔记 Markdown（ZIP）'}</button>
    <p className="mt-2 text-sm leading-relaxed text-ink-3">每篇文章一个 Markdown 文件，只读取服务端已保存笔记；无笔记的文章也保留文件。不保存整理草稿。</p>
    {error&&<p role="alert" className="mt-2 text-sm text-hot">{error}</p>}{message&&<p role="status" className="mt-2 text-sm">{message}</p>}
  </section>;
}
