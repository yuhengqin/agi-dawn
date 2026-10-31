import {useEffect,useId,useRef,useState} from 'react';
import type {BodyIssue} from '@agidawn/contracts/site';
import {IconClose,IconInfo} from '../../components/icons';
import {Menu,MenuItem} from '../../components/ui/Menu';
import {hideFigureNotices,useFigureNotices} from '../../lib/local-state';

export function FigureNotice({issues,onDismiss}:{issues:BodyIssue[];onDismiss:()=>void}){
  const preference=useFigureNotices(),[dismissed,setDismissed]=useState(false),[expanded,setExpanded]=useState(false),[message,setMessage]=useState(''),details=useRef<HTMLDivElement>(null),id=useId();
  const hidden=preference.hidden||dismissed;
  useEffect(()=>{
    if(!expanded||hidden)return;
    const outside=(event:PointerEvent)=>{if(!details.current?.contains(event.target as Node))setExpanded(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setExpanded(false);};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[expanded,hidden]);
  const hide=(all:boolean)=>{
    const saved=all?hideFigureNotices():true;
    if(!all)setDismissed(true);
    setExpanded(false);setMessage(saved?'':'已在当前标签页隐藏，浏览器未能记住设置。');onDismiss();
  };
  if(!issues.length||(hidden&&!message))return null;
  return <div className="article-figure-notice">
    {!hidden&&<>
      <div className="flex items-center gap-2">
        <div ref={details} className="article-figure-details" onMouseEnter={()=>setExpanded(true)} onMouseLeave={()=>setExpanded(false)} onFocus={()=>setExpanded(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setExpanded(false);}}>
          <button type="button" aria-describedby={expanded?id:undefined} onClick={()=>setExpanded(true)} className="article-figure-trigger"><IconInfo size={16}/><span>部分图表可能显示不完整</span></button>
          {expanded&&<div id={id} role="tooltip" className="article-figure-tooltip"><ul>{issues.map((issue,i)=><li key={i}>{issue.message}</li>)}</ul></div>}
        </div>
        <Menu label="关闭图表提示" trigger={<IconClose size={18}/>}>
          {close=><>
            <MenuItem onSelect={()=>{close();hide(false);}}>本次关闭直到下次访问</MenuItem>
            <MenuItem onSelect={()=>{close();hide(true);}}>永久禁用</MenuItem>
          </>}
        </Menu>
      </div>
    </>}
    {hidden&&message&&<p role="status">{message}</p>}
  </div>;
}
