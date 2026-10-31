import {useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import {Form,useNavigate} from 'react-router';
import {addDays,beijingDate,isValidDate,monthDay} from '@agidawn/contracts/time';
import {ReaderPopover,readerLink} from './ReaderNavigation';
import {IconChevronDown,IconChevronLeft,IconChevronRight} from '../../components/icons';

export function dateRangeLabel(from?:string,to?:string){
  return from&&to?`${from} — ${to}`:from?`${from} 起`:to?`截至 ${to}`:'不限日期';
}
const field='block min-h-10 w-full min-w-0 rounded-mark border border-line bg-surface px-2 text-base text-ink sm:text-sm focus-visible:outline-2 focus-visible:outline-accent aria-invalid:border-red-700 dark:aria-invalid:border-red-400';
const action='min-h-10 rounded-mark px-3 text-sm text-ink-3 hover:bg-bg-sunk focus-visible:outline-2 focus-visible:outline-accent';
const presetAction='min-h-10 min-w-0 rounded-mark px-1 text-sm text-ink-3 hover:bg-bg-sunk focus-visible:outline-2 focus-visible:outline-accent sm:px-3 aria-pressed:bg-accent/10 aria-pressed:font-medium aria-pressed:text-accent';
const monthAction='grid size-10 shrink-0 place-items-center rounded-mark text-ink hover:bg-bg-sunk focus-visible:outline-2 focus-visible:outline-accent';
const dayLabel=(day:string)=>`${Number(day.slice(0,4))}年${Number(day.slice(5,7))}月${Number(day.slice(8))}日`;
type DateField='from'|'to';
const validDay=(day:string)=>isValidDate(day)&&!day.startsWith('0000');
function normalizeDate(value:string){
  const match=/^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/.exec(value.trim());
  return match?`${match[1]}-${match[3]!.padStart(2,'0')}-${match[4]!.padStart(2,'0')}`:value.trim();
}
function dateError(value:string){
  if(!value)return '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return '请按 YYYY-MM-DD 输入完整日期。';
  return validDay(value)?'':'日期不存在，请检查年月日。';
}
function rangeSummary(from:string,to:string){
  if(from&&to){
    const days=(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000+1;
    return `${dayLabel(from)} — ${monthDay(to,from)}，共${days}天`;
  }
  return from?`${dayLabel(from)}起`:to?`截至${dayLabel(to)}`:'不限日期';
}
function shiftMonth(day:string,offset:number){
  const date=new Date(`${day.slice(0,7)}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+offset);
  if(date.getUTCFullYear()<1||date.getUTCFullYear()>9999)return day;
  const start=date.toISOString().slice(0,10);date.setUTCMonth(date.getUTCMonth()+1);date.setUTCDate(0);
  return addDays(start,Math.min(Number(day.slice(8)),date.getUTCDate())-1);
}

function DateDraft({query,close}:{query:Record<string,string>;close:()=>void}){
  const navigate=useNavigate(),today=beijingDate(Date.now());
  const [draft,setDraft]=useState({from:query.from??'',to:query.to??''});
  const [active,setActive]=useState<DateField>('from'),[edited,setEdited]=useState<DateField>('from');
  const [touched,setTouched]=useState({from:false,to:false}),[preview,setPreview]=useState<string|null>(null);
  const initial=validDay(query.from??'')?query.from!:validDay(query.to??'')?query.to!:today;
  const [focusDay,setFocusDay]=useState(initial),[month,setMonth]=useState(initial.slice(0,7));
  const calendar=useRef<HTMLTableElement>(null),moveFocus=useRef(false),monthButton=useRef<HTMLButtonElement>(null),yearInput=useRef<HTMLInputElement>(null);
  const [jumpOpen,setJumpOpen]=useState(false),[jumpYear,setJumpYear]=useState(''),[jumpMonth,setJumpMonth]=useState(''),[jumpError,setJumpError]=useState('');
  const from=normalizeDate(draft.from),to=normalizeDate(draft.to),fromError=dateError(from),toError=dateError(to);
  const reversed=!fromError&&!toError&&!!from&&!!to&&from>to,invalid=!!(fromError||toError||reversed);
  const errors={from:touched.from?(fromError||(reversed&&edited==='from'?'起始日期不能晚于结束日期。':'')):'',to:touched.to?(toError||(reversed&&edited==='to'?'起始日期不能晚于结束日期。':'')):''};
  const preset=!from&&!to?'all':to===today?[7,30,90].find(days=>from===addDays(today,1-days)):undefined;
  useLayoutEffect(()=>{
    if(moveFocus.current){calendar.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDay}"]`)?.focus();moveFocus.current=false;}
  },[focusDay,month]);
  useLayoutEffect(()=>{if(jumpOpen)yearInput.current?.focus();},[jumpOpen]);
  const show=(day:string,focus=false)=>{moveFocus.current=focus;setFocusDay(day);setMonth(day.slice(0,7));};
  const activate=(key:DateField)=>{setActive(key);setPreview(null);const value=normalizeDate(draft[key]);if(validDay(value))show(value);};
  const change=(key:DateField,value:string)=>{
    setDraft(previous=>({...previous,[key]:value}));setEdited(key);setPreview(null);
    const normalized=normalizeDate(value);if(validDay(normalized))show(normalized);
  };
  const choose=(day:string)=>{
    change(active,day);setTouched(previous=>({...previous,[active]:true}));
    if(active==='from')setActive('to');
  };
  const setRange=(start:string,end:string)=>{
    setDraft({from:start,to:end});setTouched({from:false,to:false});setActive('from');setEdited('from');setPreview(null);setJumpOpen(false);
    if(start||end)show(start||end);
  };
  const jump=()=>{
    if(!/^\d{1,4}$/.test(jumpYear)||Number(jumpYear)<1){setJumpError('请输入1至9999之间的年份。');return;}
    const day=`${jumpYear.padStart(4,'0')}-${jumpMonth}-01`;
    show(day);setPreview(null);monthButton.current?.focus();setJumpOpen(false);
  };
  const keyDown=(event:KeyboardEvent<HTMLButtonElement>,day:string)=>{
    const weekday=(new Date(`${day}T00:00:00Z`).getUTCDay()+6)%7;
    const delta:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday};
    const next=event.key in delta?addDays(day,delta[event.key]!):event.key==='PageUp'?shiftMonth(day,event.shiftKey?-12:-1):event.key==='PageDown'?shiftMonth(day,event.shiftKey?12:1):null;
    if(next){event.preventDefault();if(validDay(next)){show(next,true);setPreview(next);}}
  };
  const first=`${month}-01`,weekday=(new Date(`${first}T00:00:00Z`).getUTCDay()+6)%7;
  const last=new Date(`${first}T00:00:00Z`);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
  const days=last.getUTCDate(),cells=Array.from({length:Math.ceil((weekday+days)/7)*7},(_,i)=>i>=weekday&&i<weekday+days?addDays(first,i-weekday):null);
  const previewFrom=preview&&active==='from'?preview:from,previewTo=preview&&active==='to'?preview:to;
  const hasPreview=!!preview&&!dateError(previewFrom)&&!dateError(previewTo)&&!(previewFrom&&previewTo&&previewFrom>previewTo);
  const shownFrom=hasPreview?previewFrom:from,shownTo=hasPreview?previewTo:to;
  return <Form method="get" action="/" noValidate className="flex max-h-[inherit] flex-col" onSubmit={event=>{event.preventDefault();setTouched({from:true,to:true});if(invalid)return;void navigate(readerLink(query,{from:from||null,to:to||null}));close();}}>
    {Object.entries(query).filter(([key])=>!['page','from','to'].includes(key)).map(([key,value])=><input key={key} type="hidden" name={key} value={value}/>)}
    <div className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4">
    <div aria-label="日期预设" className="mb-3 grid grid-cols-4 gap-1 border-b border-line pb-2 sm:flex sm:flex-wrap">
      <button type="button" className={presetAction} aria-pressed={preset==='all'} onClick={()=>setRange('','')}>不限日期</button>
      {[7,30,90].map(days=><button key={days} type="button" className={presetAction} aria-pressed={preset===days} onClick={()=>setRange(addDays(today,1-days),today)}>近{days}天</button>)}
    </div>
    <div className="reader-date-content">
      <div className="reader-date-fields flex min-w-0 flex-col gap-3">
        <p className="text-sm font-medium text-ink">自定义范围</p>
        {(['from','to'] as const).map(key=><div key={key} className="min-w-0">
          <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
            <label htmlFor={`reader-date-${key}`} className={`text-xs ${active===key?'font-medium text-accent':'text-ink-3'}`}>{key==='from'?'起始日期':'结束日期'}</label>
            {key==='to'&&<button type="button" className="min-h-6 text-xs text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent" onClick={()=>{change('to',today);setActive('to');setTouched(previous=>({...previous,to:true}));}}>设为今天</button>}
          </div>
          <input id={`reader-date-${key}`} className={field} data-active={active===key||undefined} type="text" name={key} placeholder="YYYY-MM-DD" autoComplete="off" spellCheck={false} maxLength={10} value={draft[key]} aria-invalid={!!errors[key]} aria-describedby={`reader-date-help reader-date-${key}-error`}
            onFocus={()=>activate(key)} onChange={event=>change(key,event.currentTarget.value)} onBlur={event=>{
              setDraft(previous=>({...previous,[key]:normalizeDate(previous[key])}));
              // Choosing a day validates its replacement; an error here would move the day between pointerdown and click on mobile.
              if(!calendar.current?.contains(event.relatedTarget as Node))setTouched(previous=>({...previous,[key]:true}));
            }}/>
          <p id={`reader-date-${key}-error`} role={errors[key]?'alert':undefined} className={errors[key]?'mt-1 text-xs leading-relaxed text-red-700 dark:text-red-400':'hidden'}>{errors[key]}</p>
        </div>)}
        <p id="reader-date-help" className="text-xs leading-relaxed text-ink-3">北京时间，含起止当天；可只填一端。</p>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <button type="button" className={monthAction+' disabled:opacity-30'} aria-label="上个月" disabled={month==='0001-01'} onClick={()=>{show(shiftMonth(focusDay,-1));setPreview(null);}}><IconChevronLeft size={18}/></button>
          <button ref={monthButton} type="button" aria-label="选择年月" aria-expanded={jumpOpen} aria-controls="reader-date-month" className={action+' inline-flex items-center gap-1 font-medium text-ink'} onClick={()=>{setJumpYear(month.slice(0,4));setJumpMonth(month.slice(5));setJumpError('');setJumpOpen(!jumpOpen);}}>
            <span aria-live="polite">{Number(month.slice(0,4))}年{Number(month.slice(5))}月</span><IconChevronDown size={14}/>
          </button>
          <button type="button" className={monthAction+' disabled:opacity-30'} aria-label="下个月" disabled={month==='9999-12'} onClick={()=>{show(shiftMonth(focusDay,1));setPreview(null);}}><IconChevronRight size={18}/></button>
        </div>
        {jumpOpen&&<div id="reader-date-month" className="border-b border-line pb-2" onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();jump();}}}>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
            <label className="min-w-0 text-xs text-ink-3">年份<input ref={yearInput} type="number" min="1" max="9999" className={field} value={jumpYear} aria-invalid={!!jumpError} aria-describedby="reader-date-year-error" onChange={event=>{setJumpYear(event.currentTarget.value);setJumpError('');}}/></label>
            <label className="min-w-0 text-xs text-ink-3">月份<select className={field} value={jumpMonth} onChange={event=>setJumpMonth(event.currentTarget.value)}>{Array.from({length:12},(_,i)=><option key={i} value={String(i+1).padStart(2,'0')}>{i+1}月</option>)}</select></label>
            <button type="button" className={action+' text-accent'} onClick={jump}>跳转</button>
          </div>
          <p id="reader-date-year-error" role={jumpError?'alert':undefined} className="text-xs text-red-700 dark:text-red-400">{jumpError}</p>
        </div>}
        <p id="reader-date-instruction" aria-live="polite" className="pb-1 text-center text-xs text-accent">正在选择{active==='from'?'起始':'结束'}日期</p>
        <table ref={calendar} role="grid" aria-label="日期范围日历" aria-describedby="reader-date-instruction" aria-multiselectable="true" className="w-full table-fixed border-collapse text-center text-sm" onPointerLeave={()=>setPreview(null)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setPreview(null);}}>
          <thead><tr>{['一','二','三','四','五','六','日'].map(day=><th key={day} scope="col" className="h-7 text-xs font-normal text-ink-3" abbr={`星期${day}`}>{day}</th>)}</tr></thead>
          <tbody>{Array.from({length:cells.length/7},(_,week)=><tr key={week}>{cells.slice(week*7,week*7+7).map((day,index)=>{
            const selected=!!day&&((!!from&&!!to&&day>=from&&day<=to)||day===from||day===to);
            const inRange=!!day&&!dateError(shownFrom)&&!dateError(shownTo)&&!!shownFrom&&!!shownTo&&day>=shownFrom&&day<=shownTo,end=!!day&&(day===shownFrom||day===shownTo);
            return <td key={index} role="gridcell" aria-selected={selected} className={`reader-date-cell ${inRange?(hasPreview?'bg-accent/5':'bg-accent/10'):''}`} data-start={inRange&&day===shownFrom||undefined} data-end={inRange&&day===shownTo||undefined}>{day&&<button type="button" data-date={day} tabIndex={day===focusDay?0:-1} aria-label={dayLabel(day)} aria-current={day===today?'date':undefined}
              className={`reader-date-day outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-accent ${end?(hasPreview?'bg-accent/15 font-medium text-accent':'bg-accent font-medium text-white'):'text-ink hover:bg-bg-sunk'}`}
              onFocus={()=>setFocusDay(day)} onPointerEnter={event=>{if(event.pointerType==='mouse')setPreview(day);}} onClick={()=>choose(day)} onKeyDown={event=>keyDown(event,day)}>{Number(day.slice(8))}</button>}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-2">
      <div className="reader-date-summary text-xs leading-relaxed text-ink-3">
        <p role="status" aria-label="已选日期范围" className={hasPreview?'sr-only':''}>{invalid?'请完善日期范围':rangeSummary(from,to)}</p>
        <p role="status" aria-label="日期范围预览">{hasPreview?`预览：${rangeSummary(previewFrom,previewTo)}`:''}</p>
      </div>
      <button type="button" className={action} onClick={close}>取消</button>
      <button type="submit" disabled={invalid} className="min-h-10 rounded-mark bg-accent px-4 text-sm text-white disabled:opacity-40">应用日期</button>
    </div>
  </Form>;
}

export function ReaderDatePicker({query}:{query:Record<string,string>}){
  const [session,setSession]=useState(0);
  return <ReaderPopover label={dateRangeLabel(query.from,query.to)} className="relative shrink-0" active={!!(query.from||query.to)} panelClassName="reader-date-panel" onOpen={()=>setSession(value=>value+1)}>
    {close=><DateDraft key={`${query.from??''}:${query.to??''}:${session}`} query={query} close={close}/>}
  </ReaderPopover>;
}
