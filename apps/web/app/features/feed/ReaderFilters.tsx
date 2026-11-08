import {useEffect,useLayoutEffect,useRef,useState,type Ref} from "react";
import {Form,Link,useLocation,useNavigate,useNavigation,useNavigationType,useSubmit} from "react-router";
import type {ReaderPageData} from "./reader.server";
import {readerLink} from "./ReaderNavigation";
import {ReaderDatePicker,dateRangeLabel} from "./ReaderDatePicker";
import {IconSearch,IconChevronDown} from "../../components/icons";
import {useReaderQuery} from './useReaderQuery';

export function PreservedFilters({query,except}:{query:Record<string,string>;except:string[]}){
  const target=useReaderQuery(query);
  return Object.entries(target).filter(([key])=>key!=='page'&&!except.includes(key)).map(([key,value])=><input key={key} type="hidden" name={key} value={value}/>);
}

export function ReaderSearch({query}:{query:Record<string,string>}){
  const location=useLocation(),navigate=useNavigate(),navigation=useNavigation(),navigationType=useNavigationType();
  const [draft,setDraft]=useState(query.q??''),input=useRef<HTMLInputElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const composing=useRef(false),submitted=useRef<string|null>(null),editedFor=useRef<string|null>(null);
  const target=useReaderQuery(query),latestQuery=useRef(target);
  useLayoutEffect(()=>{latestQuery.current=target;},[target]);
  const cancel=()=>{clearTimeout(timer.current);timer.current=undefined;};
  const search=(value:string,replace:boolean)=>{
    cancel();editedFor.current=null;const href=readerLink(latestQuery.current,{q:value.trim()||null});
    if(href===location.pathname+location.search&&navigation.state==='idle')return;
    // A debounced navigation runs outside a discrete input event; update sibling forms before the next change.
    submitted.current=href;void navigate(href,{replace,preventScrollReset:true,flushSync:true});
  };
  useLayoutEffect(()=>{
    const ownSearch=navigationType!=='POP'&&submitted.current===location.pathname+location.search;
    submitted.current=null;
    // Only edits made for this history entry survive its response, even when URLs are identical.
    if(editedFor.current===location.key||ownSearch)return;
    cancel();editedFor.current=null;setDraft(query.q??'');
  },[location.key]);
  useLayoutEffect(()=>{
    if(navigation.location){cancel();editedFor.current=null;}
  },[navigation.location]);
  useEffect(()=>()=>cancel(),[]);
  const changed=(value:string)=>{
    setDraft(value);editedFor.current=navigation.location?.key??location.key;cancel();if(composing.current)return;
    if(!value)search('',true);else timer.current=setTimeout(()=>search(value,true),300);
  };
  return <Form role="search" method="get" action="/" className="flex min-w-0 items-center gap-1 rounded-control border border-line bg-surface pl-3 pr-0.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
    onSubmit={event=>{event.preventDefault();if(!composing.current)search(draft,false);}}>
    <PreservedFilters query={query} except={['q']}/>
    <input ref={input} aria-label="搜索文章" className="reader-search-input min-h-10 w-full min-w-0 bg-transparent text-base text-ink outline-none sm:text-sm" type="search" name="q" maxLength={200} value={draft} placeholder="搜索文章"
      onChange={event=>changed(event.currentTarget.value)} onCompositionStart={()=>{composing.current=true;cancel();}} onCompositionEnd={event=>{composing.current=false;changed(event.currentTarget.value);}}/>
    {draft&&<button type="button" aria-label="清除搜索" className="min-h-10 min-w-8 text-lg text-ink-3" onClick={()=>{composing.current=false;setDraft('');search('',true);input.current?.focus();}}>×</button>}
    <button type="submit" aria-label="搜索" title="搜索" className="grid size-11 shrink-0 place-items-center rounded-mark text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent"><IconSearch size={20}/></button>
  </Form>;
}

export function ReaderToolbar({query,sources,datePickerTrigger}:Pick<ReaderPageData,'query'|'sources'>&{datePickerTrigger?:Ref<HTMLElement>}){
  const submit=useSubmit(),toolbar=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const root=document.documentElement;
    const update=()=>root.style.setProperty('--reader-toolbar-height',`${toolbar.current!.getBoundingClientRect().height}px`);
    const observer=new ResizeObserver(update);observer.observe(toolbar.current!);update();
    return()=>{observer.disconnect();root.style.removeProperty('--reader-toolbar-height');};
  },[]);
  const sourceName=sources.find(source=>source.id===query.sourceId)?.name??'全部来源';
  return <div ref={toolbar} role="group" aria-label="文章检索工具" className="reader-toolbar grid grid-cols-1 gap-2 pt-3 sm:grid-cols-[minmax(180px,400px)_minmax(0,auto)] sm:items-center sm:justify-between sm:gap-x-6 lg:pt-0">
    <ReaderSearch query={query}/>
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-5 gap-y-1">
      <Form method="get" action="/" key={query.sourceId??''}>
        <PreservedFilters query={query} except={['sourceId']}/>
        <div className="reader-source-picker" data-active={query.sourceId?true:undefined}>
          <span aria-hidden="true">{sourceName}</span>
          <select aria-label="来源" name="sourceId" defaultValue={query.sourceId??''} onChange={event=>void submit(event.currentTarget.form)}>
            <option value="">全部来源</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <IconChevronDown size={16}/>
        </div>
        <noscript><button type="submit">应用来源</button></noscript>
      </Form>
      <ReaderDatePicker query={query} triggerRef={datePickerTrigger}/>
    </div>
  </div>;
}

export function ReaderFilters({query,sources,topics,categories}:Pick<ReaderPageData,'query'|'sources'|'topics'|'categories'>){
  const target=useReaderQuery(query);
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
      <span>已选条件</span>{filters.map(({key,value,label,changes})=><Link key={key} to={readerLink(target,changes)} aria-label={`移除${label}：${value}`} className="inline-flex min-h-9 items-center gap-1 text-accent hover:underline">{value}<span aria-hidden="true">×</span></Link>)}
      <Link to={readerLink(target.limit?{limit:target.limit}:{},{})} className="inline-flex min-h-9 items-center underline underline-offset-4">清除全部筛选</Link>
  </div>;
}
