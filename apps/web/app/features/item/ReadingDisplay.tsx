import {useId,useRef,useState,useSyncExternalStore,type CSSProperties} from "react";
import {DEFAULT_READING_DISPLAY,MIN_READING_SIZE,MAX_READING_SIZE,restoreFigureNotices,setReadingDisplay,useFigureNotices,useReadingDisplay,type ReadingDisplay as Display} from "../../lib/local-state";
import {ReaderPopover} from '../../components/ui/Popover';
import {IconReset,IconTypography} from '../../components/icons';

const choices=[
  {key:'spacing',label:'正文行距',shortLabel:'行距',options:[['compact','紧凑'],['default','默认'],['loose','宽松']]},
  {key:'width',label:'正文宽度',shortLabel:'页宽',options:[['narrow','窄'],['default','默认'],['wide','宽']]},
  {key:'font',label:'正文字体',shortLabel:'字体',options:[['song','宋体'],['sans','黑体'],['kai','楷体']]},
] as const;

// Match the default .prose size in app.css, including when the window is resized.
const wideProseQuery = '(min-width: 80rem)';
function subscribeDefaultSize(onChange:()=>void){
  const query=window.matchMedia(wideProseQuery);
  query.addEventListener('change',onChange);
  return ()=>query.removeEventListener('change',onChange);
}
const getDefaultSize = () => window.matchMedia(wideProseQuery).matches ? 18 : 17;

export function ReadingDisplay({floating=false}:{floating?:boolean}){
  const value=useReadingDisplay(),figures=useFigureNotices(),[message,setMessage]=useState(''),id=useId(),controls=useRef<HTMLFieldSetElement>(null);
  const slider=useRef<HTMLInputElement>(null);
  const defaultSize=useSyncExternalStore(subscribeDefaultSize,getDefaultSize,()=>18);
  const size=value.size??defaultSize;
  const sliderPosition=(size-MIN_READING_SIZE)/(MAX_READING_SIZE-MIN_READING_SIZE);
  const title='阅读设置';
  const apply=(next:Display)=>setMessage(setReadingDisplay(next)?'':'仅当前标签页生效，未能保存设置。');
  const isDefault=value===DEFAULT_READING_DISPLAY;
  const resetLabel='重置设置';
  const reset=<span className="reading-reset">
    <button type="button" className="reading-reset-button" aria-label={resetLabel} disabled={isDefault} onClick={()=>{
      apply(DEFAULT_READING_DISPLAY);slider.current?.focus({preventScroll:true});
    }}><IconReset size={17}/></button>
    <span className="reading-reset-hint" aria-hidden="true">{resetLabel}</span>
  </span>;
  const fields=<fieldset ref={controls} tabIndex={-1} className={`grid min-w-0 ${floating?'':'gap-3 pb-4 sm:grid-cols-4'}`}>
      <legend className="sr-only">调整正文排版</legend>
      <div className="reading-display-row">
        <label htmlFor={id+'-size'} className="reading-display-label">{floating?'字号':'正文字号'}</label>
        <div className="reading-size-control">
          <input ref={slider} className="reading-size-slider" id={id+'-size'} type="range"
            min={MIN_READING_SIZE} max={MAX_READING_SIZE} step={1} value={size}
            aria-label="正文字号" aria-valuetext={size+' 像素'}
            style={{'--reading-slider-position':sliderPosition} as CSSProperties}
            onChange={event=>apply({...value,size:event.currentTarget.valueAsNumber})}/>
          <span aria-hidden="true" className="reading-size-value">{size}px</span>
        </div>
      </div>
      {choices.map(({key,label,shortLabel,options})=><fieldset key={key} className="min-w-0">
        <legend className={floating?'sr-only':'mb-1.5 text-[13px]'}>{label}</legend>
        <div className="reading-display-row">
          {floating&&<span aria-hidden="true" className="reading-display-label">{shortLabel}</span>}
          <div className="reading-display-options">{options.map(([option,text])=><label key={option}>
            <input type="radio" name={`${id}-${key}`} value={option} checked={value[key]===option} onChange={()=>apply({...value,[key]:option})}/><span>{text}</span>
          </label>)}</div>
        </div>
      </fieldset>)}
      {figures.hidden&&<div className={floating?'':'sm:col-span-4'}><button type="button" onClick={()=>{
        setMessage(restoreFigureNotices()?'图表提示已恢复':'当前标签页已恢复，未能保存设置。');controls.current?.focus({preventScroll:true});
      }} className="min-h-9 text-[13px] text-accent underline underline-offset-4">恢复图表提示</button></div>}
      <p role="status" className={message?`text-xs leading-relaxed text-ink-3 ${floating?'pt-2':'sm:col-span-4'}`:'sr-only'}>{message}</p>
    </fieldset>;
  return floating?<ReaderPopover closeOnPageScroll triggerLabel={title} label={<IconTypography size={20}/>} className="article-display-control relative" panelClassName="article-display-panel">
    <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">{title}</p>{reset}</div>
    {fields}
  </ReaderPopover>:<details className="relative my-5 min-w-0 border-y border-line py-1">
    <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium text-accent">{title}</summary>
    <div className="absolute end-0 top-3">{reset}</div>
    {fields}
  </details>;
}
