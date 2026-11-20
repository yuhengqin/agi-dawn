import {lazy,Suspense,useEffect,useId,useRef,useState} from 'react';
import type {BodyIssue} from '@agidawn/contracts/site';
import {IconClose,IconInfo} from '../../components/icons';
import {hideFigureNotices,useFigureNotices} from '../../lib/local-state';

const FigureDismissMenu=lazy(()=>import('./FigureDismissMenu'));
const SOURCE_STYLE_ISSUES=new Set(['图表依赖原站样式，保存的图形可能不完整。','图表依赖原站样式，保留了文字说明，请对照原文。']);

export function FigureNotice({issues,onDismiss}:{issues:BodyIssue[];onDismiss:()=>void}){
  const preference=useFigureNotices(),[dismissed,setDismissed]=useState(false),[expanded,setExpanded]=useState(false),[message,setMessage]=useState(''),details=useRef<HTMLDivElement>(null),id=useId();
  const hidden=preference.hidden||dismissed;
  const messages=[...new Set(issues.filter(({message})=>!SOURCE_STYLE_ISSUES.has(message)).map(({message})=>message))],hasDetails=messages.length>0;
  useEffect(()=>{
    if(!expanded||hidden||!hasDetails)return;
    const outside=(event:PointerEvent)=>{if(!details.current?.contains(event.target as Node))setExpanded(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setExpanded(false);}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[expanded,hidden,hasDetails]);
  const hide=(all:boolean)=>{
    const saved=all?hideFigureNotices():true;
    if(!all)setDismissed(true);
    setExpanded(false);setMessage(saved?'':'已在当前标签页隐藏，浏览器未能记住设置。');onDismiss();
  };
  if(!issues.length||(hidden&&!message))return null;
  const missing=issues.some(issue=>/部分图表未保存|此图未保存/.test(issue.message));
  const label=<><IconInfo size={16}/><span>{missing?'部分图表未保存':'部分图表可能显示不完整'}</span></>;
  return <div className="article-figure-notice">
    {!hidden&&<>
      <div className="flex items-center gap-2">
        <div ref={details} className="article-figure-details" onMouseEnter={()=>setExpanded(hasDetails)} onMouseLeave={()=>setExpanded(false)} onFocus={()=>setExpanded(hasDetails)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setExpanded(false);}}>
          {hasDetails?<button type="button" data-interactive="true" aria-describedby={expanded?id:undefined} onClick={()=>setExpanded(true)} className="article-figure-trigger">{label}</button>:<span className="article-figure-trigger">{label}</span>}
          {hasDetails&&expanded&&<div id={id} role="tooltip" className="article-figure-tooltip"><ul>{messages.map(message=><li key={message}>{message}</li>)}</ul></div>}
        </div>
        <Suspense fallback={<button type="button" aria-label="关闭图表提示" className="grid size-11 place-items-center text-ink-3" disabled><IconClose size={18}/></button>}>
          <FigureDismissMenu onHide={hide}/>
        </Suspense>
      </div>
    </>}
    {hidden&&message&&<p role="status">{message}</p>}
  </div>;
}
