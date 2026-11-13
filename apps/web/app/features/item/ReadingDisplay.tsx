import {useId,useRef,useState} from "react";
import {DEFAULT_READING_DISPLAY,restoreFigureNotices,setReadingDisplay,useFigureNotices,useReadingDisplay,type ReadingDisplay as Display} from "../../lib/local-state";
import {ReaderPopover} from '../feed/ReaderNavigation';
import {IconMore} from '../../components/icons';

const choices=[
  {key:'size',label:'正文字号',options:[['default','默认'],['large','较大'],['larger','更大']]},
  {key:'spacing',label:'正文行距',options:[['compact','紧凑'],['default','默认'],['loose','宽松']]},
  {key:'width',label:'正文宽度',options:[['narrow','窄'],['default','默认'],['wide','宽']]},
] as const;
export function ReadingDisplay({floating=false}:{floating?:boolean}){
  const value=useReadingDisplay(),figures=useFigureNotices(),[message,setMessage]=useState(''),id=useId(),controls=useRef<HTMLFieldSetElement>(null);
  const apply=(next:Display)=>setMessage(setReadingDisplay(next)?"显示设置已记住":"已在当前标签页应用，浏览器未能记住设置。");
  const isDefault=choices.every(({key})=>value[key]===DEFAULT_READING_DISPLAY[key]);
  const fields=<fieldset ref={controls} tabIndex={-1} className={`grid min-w-0 gap-3 ${floating?'':'pb-4 sm:grid-cols-3'}`}><legend className="sr-only">调整正文排版</legend>
      {choices.map(({key,label,options})=><fieldset key={key} className="min-w-0"><legend className="mb-1.5 text-[13px]">{label}</legend>
        <div className="reading-display-options">{options.map(([option,text])=><label key={option}>
          <input type="radio" name={`${id}-${key}`} value={option} checked={value[key]===option} onChange={()=>apply({...value,[key]:option})}/><span>{text}</span>
        </label>)}</div>
      </fieldset>)}
      <p className={`text-xs leading-relaxed text-ink-3 ${floating?'':'sm:col-span-3'}`}>选择保存在当前浏览器，应用于文章正文。</p>
      {figures.hidden&&<div className={floating?'':'sm:col-span-3'}><button type="button" onClick={()=>{
        setMessage(restoreFigureNotices()?'图表提示已恢复':'已在当前标签页恢复，浏览器未能记住设置。');controls.current?.focus({preventScroll:true});
      }} className="min-h-9 text-[13px] text-accent underline underline-offset-4">恢复图表提示</button></div>}
      <div className={floating?'':'sm:col-span-3'}><button type="button" disabled={isDefault} onClick={()=>apply(DEFAULT_READING_DISPLAY)} className="min-h-9 rounded-control border border-line px-3 text-[13px] disabled:cursor-default disabled:opacity-50">恢复默认显示</button>{message&&<p role="status" className="mt-2 text-xs text-ink-3">{message}</p>}</div>
    </fieldset>;
  return floating?<ReaderPopover closeOnPageScroll triggerLabel="阅读显示设置" label={<IconMore size={20}/>} className="article-display-control relative" panelClassName="article-display-panel"><p className="mb-3 text-sm font-semibold">阅读显示设置</p>{fields}</ReaderPopover>:<details className="my-5 min-w-0 border-y border-line py-1"><summary className="min-h-12 cursor-pointer py-3 text-sm font-medium text-accent">阅读显示设置</summary>{fields}</details>;
}
