import {useEffect,useLayoutEffect,useRef,useState} from "react";
import {Form,Link,useLocation,useNavigate,useNavigation,useNavigationType,useSubmit} from "react-router";
import type {ReaderPageData} from "./reader.server";
import {readerLink} from "./ReaderNavigation";
import {ReaderDatePicker,dateRangeLabel} from "./ReaderDatePicker";
import {IconSearch} from "../../components/icons";

export function PreservedFilters({query,except}:{query:Record<string,string>;except:string[]}){
  return Object.entries(query).filter(([key])=>key!=='page'&&!except.includes(key)).map(([key,value])=><input key={key} type="hidden" name={key} value={value}/>);
}

export function ReaderSearch({query}:{query:Record<string,string>}){
  const location=useLocation(),navigate=useNavigate(),navigation=useNavigation(),navigationType=useNavigationType();
  const [draft,setDraft]=useState(query.q??''),input=useRef<HTMLInputElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const composing=useRef(false),submitted=useRef<string|null>(null);
  const cancel=()=>{clearTimeout(timer.current);timer.current=undefined;};
  const search=(value:string,replace:boolean)=>{
    cancel();const href=readerLink(query,{q:value.trim()||null});
    if(href===location.pathname+location.search&&navigation.state==='idle')return;
    submitted.current=href;void navigate(href,{replace,preventScrollReset:true});
  };
  useLayoutEffect(()=>{
    if(navigationType!=='POP'&&submitted.current===location.pathname+location.search)return;
    cancel();submitted.current=null;setDraft(query.q??'');
  },[location.key]);
  useEffect(()=>{
    if(navigation.location&&navigation.location.pathname+navigation.location.search!==submitted.current)cancel();
  },[navigation.location]);
  useEffect(()=>()=>cancel(),[]);
  const changed=(value:string)=>{
    setDraft(value);cancel();if(composing.current)return;
    if(!value)search('',true);else timer.current=setTimeout(()=>search(value,true),300);
  };
  const busy=navigation.state!=='idle'&&navigation.location?.pathname==='/'&&navigation.location.search!==location.search;
  return <Form role="search" method="get" action="/" className="relative flex min-w-0 items-center gap-1 rounded-control border border-line bg-surface pl-3 pr-0.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
    onSubmit={event=>{event.preventDefault();if(!composing.current)search(draft,false);}}>
    <PreservedFilters query={query} except={['q']}/>
    <input ref={input} aria-label="搜索文章" className="reader-search-input min-h-10 w-full min-w-0 bg-transparent text-base text-ink outline-none sm:text-sm" type="search" name="q" maxLength={200} value={draft} placeholder="搜索文章"
      onChange={event=>changed(event.currentTarget.value)} onCompositionStart={()=>{composing.current=true;cancel();}} onCompositionEnd={event=>{composing.current=false;changed(event.currentTarget.value);}}/>
    {draft&&<button type="button" aria-label="清除搜索" className="min-h-10 min-w-8 text-lg text-ink-3" onClick={()=>{composing.current=false;setDraft('');search('',true);input.current?.focus();}}>×</button>}
    <button type="submit" aria-label="搜索" title="搜索" className="grid size-11 shrink-0 place-items-center rounded-mark text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent"><IconSearch size={20}/></button>
    <span role="status" className="absolute right-0 top-full pt-1 text-[11px] text-ink-3">{busy?'正在更新…':''}</span>
  </Form>;
}

export function ReaderToolbar({query,sources}:Pick<ReaderPageData,'query'|'sources'>){
  const submit=useSubmit();
  return <div className="grid grid-cols-1 gap-2 pt-3 sm:grid-cols-[minmax(180px,400px)_minmax(0,auto)] sm:items-center sm:justify-between sm:gap-x-6 lg:pt-0">
    <ReaderSearch query={query}/>
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-5 gap-y-1">
      <Form method="get" action="/" key={query.sourceId??''}>
        <PreservedFilters query={query} except={['sourceId']}/>
        <select aria-label="来源" className="min-h-10 max-w-[180px] bg-transparent text-xs text-ink-3" name="sourceId" defaultValue={query.sourceId??''} onChange={event=>void submit(event.currentTarget.form)}>
          <option value="">全部来源</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <noscript><button type="submit">应用来源</button></noscript>
      </Form>
      <ReaderDatePicker query={query}/>
    </div>
  </div>;
}

export function ReaderFilters({query,sources,topics,categories}:Pick<ReaderPageData,'query'|'sources'|'topics'|'categories'>){
  const choices:Array<{key:string;value:string|undefined;label:string;changes:Record<string,null>}>= [
    {key:'category',value:query.category&&(categories.find(c=>c.id===query.category)?.name??query.category),label:'类别',changes:{category:null}},
    {key:'topic',value:query.topic&&(topics.find(t=>t.slug===query.topic)?.name??query.topic),label:'主题',changes:{topic:null}},
    {key:'sourceId',value:query.sourceId&&(sources.find(s=>s.id===query.sourceId)?.name??query.sourceId),label:'来源',changes:{sourceId:null}},
    {key:'q',value:query.q,label:'搜索',changes:{q:null}},
    {key:'date',value:(query.from||query.to)&&dateRangeLabel(query.from,query.to),label:'日期',changes:{from:null,to:null}},
  ];
  const filters=choices.filter(filter=>filter.value);
  if(filters.length<2)return null;
  return <div aria-label="当前筛选" className="flex min-w-0 flex-wrap items-center gap-x-3 border-b border-line py-2 text-xs text-ink-3">
      <span>已选条件</span>{filters.map(({key,value,label,changes})=><Link key={key} to={readerLink(query,changes)} aria-label={`移除${label}：${value}`} className="inline-flex min-h-9 items-center gap-1 text-accent hover:underline">{value}<span aria-hidden="true">×</span></Link>)}
      <Link to={readerLink(query.limit?{limit:query.limit}:{},{})} className="inline-flex min-h-9 items-center underline underline-offset-4">清除全部筛选</Link>
  </div>;
}
