import {useCallback,useEffect,useRef,useState,type RefObject} from "react";
import {useBlocker,useOutletContext} from "react-router";
import {OwnerRequestError} from "../client.ts";

export const taxonomyInput="min-h-10 min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2";
export const taxonomyButton="inline-flex min-h-9 shrink-0 items-center justify-center rounded-control px-3 text-sm font-medium disabled:opacity-50";
export const primaryTaxonomyButton=taxonomyButton+" bg-accent text-accent-contrast";
export const secondaryTaxonomyButton=taxonomyButton+" border border-line-strong bg-surface text-accent hover:bg-bg-sunk";

export function useTaxonomyCommand(input:RefObject<HTMLInputElement|null>){
  const [pending,setPending]=useState<"save"|"read"|null>(null);
  const [error,setError]=useState(""),[message,setMessage]=useState("");
  const running=useRef(false),{expireSession}=useOutletContext<{expireSession:()=>void}>();
  const wasPending=useRef(false);
  useEffect(()=>{
    if(wasPending.current&&!pending&&document.activeElement===document.body)input.current?.focus({preventScroll:true});
    wasPending.current=!!pending;
  },[pending,input]);
  const clearFeedback=()=>{setError("");setMessage("");};
  const run=async(kind:"save"|"read",work:()=>Promise<string>)=>{
    if(running.current)return;
    running.current=true;setPending(kind);clearFeedback();
    try{setMessage(await work());}
    catch(error){
      if(error instanceof OwnerRequestError&&error.status===401)expireSession();
      else if(error instanceof OwnerRequestError&&error.status<500)setError(`${error.message}。输入已保留。`);
      else setError(kind==="read"?"暂时无法核对，输入已保留，请重试。":"未能确认保存结果，输入已保留，请先核对已保存内容。");
    }finally{running.current=false;setPending(null);}
  };
  return {pending,error,message,run,clearFeedback};
}

// These directories only add and edit entries. A response can predate a confirmed local write.
export function mergeTaxonomyCatalog<T extends {version:number}>(current:T[],snapshot:T[],key:(item:T)=>string):T[]{
  const previous=new Map(current.map(item=>[key(item),item]));
  const updated=snapshot.map(item=>{
    const id=key(item),known=previous.get(id);
    previous.delete(id);
    return known&&known.version>item.version?known:item;
  });
  return [...updated,...previous.values()];
}

export type TrackTaxonomyDraft=(id:string,dirty:boolean)=>void;

export function useTaxonomyDraftGuard(){
  const [drafts,setDrafts]=useState<Set<string>>(()=>new Set());
  const track=useCallback<TrackTaxonomyDraft>((id,dirty)=>{
    setDrafts(current=>{
      if(current.has(id)===dirty)return current;
      const next=new Set(current);
      if(dirty)next.add(id);else next.delete(id);
      return next;
    });
  },[]);
  const dirty=drafts.size>0;
  const blocker=useBlocker(({currentLocation,nextLocation})=>dirty&&currentLocation.pathname!==nextLocation.pathname);
  useEffect(()=>{
    if(blocker.state==="blocked"){
      if(window.confirm("还有未保存的修改。确定放弃草稿并离开？"))blocker.proceed();
      else blocker.reset();
    }
  },[blocker]);
  useEffect(()=>{
    if(!dirty)return;
    const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",protect);
    return ()=>window.removeEventListener("beforeunload",protect);
  },[dirty]);
  return track;
}

export function useTaxonomyDraft(track:TrackTaxonomyDraft,id:string,dirty:boolean){
  useEffect(()=>{
    if(!dirty)return;
    track(id,true);
    return ()=>track(id,false);
  },[track,id,dirty]);
}
