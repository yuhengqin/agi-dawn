import {useState} from "react";
import {DEFAULT_READING_DISPLAY,restoreFigureNotices,setReadingDisplay,useFigureNotices,useReadingDisplay,type ReadingDisplay as Display} from "../../lib/local-state";
import {ReaderPopover} from '../feed/ReaderNavigation';
import {IconMore} from '../../components/icons';

const control="mt-1 block min-h-12 w-full min-w-0 rounded-control border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-accent";
export function ReadingDisplay({floating=false}:{floating?:boolean}){
  const value=useReadingDisplay(),figures=useFigureNotices(),[message,setMessage]=useState("");
  const apply=(next:Display)=>setMessage(setReadingDisplay(next)?"显示设置已记住":"已在当前标签页应用，浏览器未能记住设置。");
  const fields=<fieldset className={`grid min-w-0 gap-4 ${floating?'':'pb-4 sm:grid-cols-3'}`}><legend className="sr-only">调整正文排版</legend>
      <label className="min-w-0 text-sm">正文字号<select value={value.size} onChange={event=>apply({...value,size:event.target.value as Display['size']})} className={control}><option value="default">默认</option><option value="large">较大</option><option value="larger">更大</option></select></label>
      <label className="min-w-0 text-sm">正文行距<select value={value.spacing} onChange={event=>apply({...value,spacing:event.target.value as Display['spacing']})} className={control}><option value="compact">紧凑</option><option value="default">默认</option><option value="loose">宽松</option></select></label>
      <label className="min-w-0 text-sm">正文宽度<select value={value.width} onChange={event=>apply({...value,width:event.target.value as Display['width']})} className={control}><option value="narrow">窄</option><option value="default">默认</option><option value="wide">宽</option></select></label>
      <p className={`text-sm leading-relaxed text-ink-3 ${floating?'':'sm:col-span-3'}`}>当前浏览器记住选择，应用于文章正文。手机上正文宽度以屏幕可用空间为限。</p>
      <div className={floating?'':'sm:col-span-3'}><p className="text-sm">图表完整性提示</p><p className="mt-1 text-sm leading-relaxed text-ink-3">{figures.hidden?'已关闭普通文章的图表提示。':'普通文章遇到图表保存问题时显示提示。'}</p><button type="button" disabled={!figures.hidden} onClick={()=>setMessage(restoreFigureNotices()?'图表提示已恢复':'已在当前标签页恢复，浏览器未能记住设置。')} className="mt-2 min-h-11 rounded-control border border-line px-3 text-sm disabled:opacity-50">恢复图表提示</button></div>
      <div className={floating?'':'sm:col-span-3'}><button type="button" onClick={()=>apply(DEFAULT_READING_DISPLAY)} className="min-h-12 rounded-control border border-line px-4">恢复默认显示</button>{message&&<p role="status" className="mt-2 text-sm text-ink-3">{message}</p>}</div>
    </fieldset>;
  return floating?<ReaderPopover triggerLabel="阅读显示设置" label={<IconMore size={20}/>} className="article-display-control relative" panelClassName="article-display-panel"><p className="mb-4 text-sm font-semibold">阅读显示设置</p>{fields}</ReaderPopover>:<details className="my-5 min-w-0 border-y border-line py-1"><summary className="min-h-12 cursor-pointer py-3 text-sm font-medium text-accent">阅读显示设置</summary>{fields}</details>;
}
