import {useState,type FormEvent} from "react";
import {Form} from "react-router";
import {addDays,beijingDate} from "@agidawn/contracts/time";

const control="mt-1 block min-h-12 w-full min-w-0 max-w-full rounded-control border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-accent";
export default function LibraryDates({query,onApply}:{query:Record<string,string>;onApply:(changes:Record<string,string>)=>void}){
  const [from,setFrom]=useState(query.dateFrom??""),[to,setTo]=useState(query.dateTo??"");
  const recent=(days:number)=>{const today=beijingDate(Date.now());setFrom(addDays(today,1-days));setTo(today);};
  function apply(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    onApply({dateField:String(data.get("dateField")),dateFrom:from,dateTo:to});
  }
  return <Form method="get" action="/admin/reader" onSubmit={apply} className="col-span-full min-w-0">
    {Object.entries(query).filter(([key])=>!["cursor","dateField","dateFrom","dateTo"].includes(key)).map(([key,value])=><input key={key} type="hidden" name={key} value={value}/>)}
    <fieldset className="grid min-w-0 gap-4 border-y border-line py-4 sm:grid-cols-2 lg:grid-cols-3" aria-describedby="library-dates-help"><legend className="px-1 text-sm font-medium">日期范围</legend>
    <label className="min-w-0 text-sm">日期依据<select name="dateField" defaultValue={query.dateField??"collected"} className={control}><option value="collected">收录时间</option><option value="note-updated">笔记更新时间</option></select></label>
    <label className="min-w-0 text-sm">开始日期<input type="date" name="dateFrom" min="0001-01-01" max={to||"9999-12-31"} value={from} onChange={event=>setFrom(event.target.value)} className={control}/></label>
    <label className="min-w-0 text-sm">结束日期<input type="date" name="dateTo" min={from||"0001-01-01"} max="9999-12-31" value={to} onChange={event=>setTo(event.target.value)} className={control}/></label>
    <div className="col-span-full flex flex-wrap gap-3">
      {[7,30].map(days=><button key={days} type="button" onClick={()=>recent(days)} className="min-h-12 rounded-control border border-line px-4">近 {days} 天</button>)}
      <button type="button" onClick={()=>{setFrom("");setTo("");}} className="min-h-12 px-3 text-accent underline">清除日期</button>
      <button type="submit" className="min-h-12 rounded-control bg-accent px-4 text-white">应用日期</button>
    </div>
    <p id="library-dates-help" className="col-span-full text-sm leading-relaxed text-ink-3">按北京时间，包含开始日和结束日，可只填一端。快捷范围包含今天。笔记日期只匹配有内容的已保存笔记，排序另行选择。</p>
    </fieldset>
  </Form>;
}
