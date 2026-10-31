import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import type {ArticleEngagement,ReaderItemSummary} from '@agidawn/contracts/site';
import {IconBookmark,IconHeart} from '../../components/icons';

type State={items:Record<string,ArticleEngagement>;ready:boolean;update:(item:ArticleEngagement)=>void};
const EngagementContext=createContext<State|null>(null);
async function request<T>(url:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(url,{...init,credentials:'same-origin'});
  if(!response.ok)throw new Error('engagement unavailable');return response.json() as Promise<T>;
}
export function EngagementProvider({items,trackView,children}:{items:ReaderItemSummary[];trackView?:string;children:ReactNode}){
  const [values,setValues]=useState<Record<string,ArticleEngagement>>({}),[ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const ids=items.map(i=>i.id).join(',');
  useEffect(()=>{
    if(!ids)return;
    if(!navigator.locks){setError('匿名互动需要 HTTPS 或 localhost 连接与新版浏览器。');return;}
    const controller=new AbortController();let sent=false;
    setReady(false);setError('');
    // A slow view response must not replace a like submitted while it was in flight.
    const update=(item:ArticleEngagement)=>{if(!controller.signal.aborted)setValues(previous=>({...previous,[item.id]:{...previous[item.id]!,views:Math.max(previous[item.id]?.views??0,item.views)}}));};
    const view=()=>{
      if(!trackView||sent||document.visibilityState!=='visible'||controller.signal.aborted)return;
      sent=true;
      void request<ArticleEngagement>(`/api/site/items/${trackView}/view`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal}).then(update).catch(()=>{if(!controller.signal.aborted)setError('阅读数暂未更新。');});
    };
    // The first response sets a shared Cookie; serialize initialization across tabs.
    void navigator.locks.request('reader-visitor',{signal:controller.signal},()=>request<{items:ArticleEngagement[]}>(`/api/site/engagement?${new URLSearchParams({ids})}`,{signal:controller.signal})).then(result=>{
      if(controller.signal.aborted)return;
      setValues(Object.fromEntries(result.items.map(i=>[i.id,i])));setReady(true);
      document.addEventListener('visibilitychange',view);view();
    }).catch(()=>{if(!controller.signal.aborted)setError('互动数据暂时无法加载。');});
    return()=>{controller.abort();document.removeEventListener('visibilitychange',view);};
  },[ids,trackView,attempt]);
  return <EngagementContext.Provider value={{items:values,ready,update:item=>setValues(previous=>({...previous,[item.id]:{...item,views:Math.max(previous[item.id]?.views??0,item.views)}}))}}>
    {error&&<p role="status" className="my-2 text-sm text-ink-3">{error}<button type="button" className="ml-2 min-h-11 underline" onClick={()=>setAttempt(n=>n+1)}>重试</button></p>}
    {children}
  </EngagementContext.Provider>;
}
export function ArticleEngagementBar({item,compact=false}:{item:ReaderItemSummary;compact?:boolean}){
  const state=useContext(EngagementContext),current=state?.items[item.id],counts=current??item.engagement;
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  async function toggle(){
    if(!current||pending)return;setPending(true);setError('');
    try{state?.update(await request<ArticleEngagement>(`/api/site/items/${item.id}/like`,{method:current.liked?'DELETE':'PUT',headers:{'Content-Type':'application/json'},body:'{}'}));}
    catch{setError('点赞未能保存，请重试。');}finally{setPending(false);}
  }
  return <div className={`flex flex-wrap items-center gap-x-4 text-ink-3 tabular-nums ${compact?'text-xs':'text-[13px]'}`}>
    <span title="本站详情打开次数，同一浏览器30分钟内去重">阅读 {counts.views.toLocaleString('zh-CN')}</span>
    <button type="button" aria-label={current?.liked?'取消点赞':'点赞'} aria-pressed={current?.liked??false} disabled={!state?.ready||!current||pending} onClick={()=>void toggle()}
      className={`inline-flex items-center gap-1.5 hover:text-accent aria-pressed:text-accent disabled:cursor-wait ${compact?'min-h-7 [@media(pointer:coarse)]:min-h-11':'min-h-11'}`} title="同一浏览器可点赞一次，再点取消">
      <IconHeart size={15} fill={current?.liked?'currentColor':'none'}/><span>{counts.likes.toLocaleString('zh-CN')}</span>
    </button>
    <span className="inline-flex items-center gap-1.5 text-ink-4" aria-label="收藏暂未开放" title="收藏暂未开放"><IconBookmark size={14}/><span>—</span></span>
    {error&&<span role="status" className="basis-full text-sm">{error}</span>}
  </div>;
}
