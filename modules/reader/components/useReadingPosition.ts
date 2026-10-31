import {useEffect,useRef,useState,type RefObject} from 'react';
import {useOutletContext} from 'react-router';
import {OwnerRequestError,ownerMe,ownerRequest} from '../client.ts';
import type {ReaderPosition,ReaderPositionRecord,SnapshotView} from '../contracts.ts';
import {READING_DISPLAY_CHANGE_EVENT} from '../../../apps/web/app/lib/local-state.ts';
import {captureReadingPoint as atPosition,restoreReadingPoint as restore,type ReadingPoint as Point} from '../../../apps/web/app/lib/reading-position.ts';

const pointKey=(point:Point)=>JSON.stringify([point.anchor,point.offset,point.progress]);

export function useReadingPosition(snapshot:SnapshotView,rootRef:RefObject<HTMLDivElement|null>){
  const [offer,setOffer]=useState<ReaderPositionRecord|null>(null),[message,setMessage]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const controls=useRef<{navigate:()=>void;resume:()=>void;reload:()=>void}|null>(null);
  const {expireSession}=useOutletContext<{expireSession:()=>void}>();
  const idsKey=(snapshot.outline??[]).map(entry=>entry.id).join(' ');
  useEffect(()=>{
    const root=rootRef.current;if(!root)return;
    const ids=idsKey?idsKey.split(' '):[],url='/api/admin/reader/snapshots/'+snapshot.id+'/position';
    let active=true,ready=false,csrf='',version=0,armed=false,stopped=false,running=false,pending:Point|null=null,lastSaved='',saved:ReaderPosition|null=null,timer:ReturnType<typeof setTimeout>|undefined;
    let restoreObserver:ResizeObserver|null=null,restorePoint:Point|null=null;
    const stopRestore=()=>{restoreObserver?.disconnect();restoreObserver=null;window.removeEventListener('resize',adjust);};
    const adjust=()=>{if(restorePoint)restore(root,ids,restorePoint);};
    const watchRestore=(point:Point)=>{stopRestore();armed=false;restorePoint=point;restoreObserver=new ResizeObserver(adjust);restoreObserver.observe(root);window.addEventListener('resize',adjust);};
    const displayChange=()=>{const point=atPosition(root,ids);if(point)watchRestore(point);};
    const fail=(problem:unknown)=>{
      stopped=true;pending=null;
      if(!active)return;
      if(problem instanceof OwnerRequestError&&problem.status===401){expireSession();return;}
      setError(problem instanceof OwnerRequestError&&problem.status===409?'另一窗口已更新阅读位置，已停止自动保存。请载入阅读位置后继续。':'阅读位置暂未保存，已停止自动保存。请载入阅读位置后继续。');
    };
    const persist=()=>{
      if(!ready||running||stopped||!pending)return;
      const point=pending;pending=null;if(pointKey(point)===lastSaved)return;
      running=true;
      void ownerRequest<ReaderPosition>(url,'PUT',{...point,expectedVersion:version},{csrf,keepalive:true}).then(value=>{
        version=value.version;lastSaved=pointKey(point);saved=value;
        if(active){setMessage('阅读位置已保存');setError('');}
      }).catch(fail).finally(()=>{running=false;if(pending&&!stopped){if(active)timer=setTimeout(persist,750);else persist();}});
    };
    const capture=()=>{if(!armed||!ready||stopped)return;const point=atPosition(root,ids);if(point){pending=point;clearTimeout(timer);timer=setTimeout(persist,750);}};
    const navigate=()=>{stopRestore();armed=true;if(active)setOffer(null);};
    const keydown=(event:KeyboardEvent)=>{if(event.target instanceof Element&&event.target.closest('input,textarea,select,button,a,summary,[contenteditable]'))return;if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key))navigate();};
    const pointer=(event:PointerEvent)=>{if(event.target instanceof Element&&event.target.closest('input,textarea,select,button,a,summary,[contenteditable]'))return;navigate();};
    const load=async()=>{
      stopRestore();armed=false;ready=false;pending=null;clearTimeout(timer);setLoading(true);setError('');setMessage('');
      try{
        const me=await ownerMe();if(!active)return;csrf=me.csrf;
        const record=await ownerRequest<ReaderPositionRecord>(url,'GET',undefined,{csrf});if(!active)return;
        saved=record.position;version=saved?.version??0;lastSaved=saved?pointKey(saved):'';stopped=false;ready=true;setOffer(record);
      }catch(problem){fail(problem);}finally{if(active)setLoading(false);}
    };
    const resume=()=>{
      if(!ready||!saved)return;stopRestore();armed=false;
      if(!restore(root,ids,saved)){setError('当前正文无法定位该章节，请重新载入阅读位置。');return;}
      const target=saved.anchor?root.querySelector<HTMLElement>('#'+saved.anchor):root;target?.setAttribute('tabindex','-1');target?.focus({preventScroll:true});
      watchRestore(saved);
      setOffer(null);setMessage('已恢复到上次阅读位置');
    };
    const flush=()=>{clearTimeout(timer);capture();clearTimeout(timer);persist();};
    const visibility=()=>{if(document.visibilityState==='hidden')flush();};
    controls.current={navigate,resume,reload:()=>{if(!running)void load();}};
    void load();window.addEventListener('scroll',capture,{passive:true});window.addEventListener('wheel',navigate,{passive:true});window.addEventListener('touchmove',navigate,{passive:true});window.addEventListener('keydown',keydown);window.addEventListener('pointerdown',pointer);window.addEventListener('pagehide',flush);window.addEventListener(READING_DISPLAY_CHANGE_EVENT,displayChange);document.addEventListener('visibilitychange',visibility);
    return()=>{
      active=false;stopRestore();flush();controls.current=null;
      window.removeEventListener('scroll',capture);window.removeEventListener('wheel',navigate);window.removeEventListener('touchmove',navigate);window.removeEventListener('keydown',keydown);window.removeEventListener('pointerdown',pointer);window.removeEventListener('pagehide',flush);window.removeEventListener(READING_DISPLAY_CHANGE_EVENT,displayChange);document.removeEventListener('visibilitychange',visibility);
    };
  },[snapshot.id,idsKey,rootRef]);
  return {offer,message,error,loading,navigate:()=>controls.current?.navigate(),resume:()=>controls.current?.resume(),reload:()=>controls.current?.reload()};
}
