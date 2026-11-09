import {useLayoutEffect,useRef,useState,type ChangeEvent,type FormEvent} from "react";
import {Form,Link,useLoaderData,useLocation,useNavigate,useNavigation,useNavigationType,type LoaderFunctionArgs} from "react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {searchWords} from "@agidawn/contracts/search";
import {IconCheck,IconChevronDown,IconFilter} from "../../../apps/web/app/components/icons.tsx";
import {Menu} from "../../../apps/web/app/components/ui/Menu.tsx";
import {adminGet} from "../../../apps/web/app/lib/admin.server.ts";
import {readerViewQueryKeys,type ReaderLibrary} from "../contracts.ts";
import {librarySearch} from "../library-navigation.ts";
import LibraryOrganizer from "../components/LibraryOrganizer.tsx";
import SavedViews,{describeLibraryQuery} from "../components/SavedViews.tsx";
import LibraryDates from "../components/LibraryDates.tsx";

export const headers=()=>({"Cache-Control":"no-store"});
export const shouldRevalidate=()=>true;

function keywordError(value:string) {
  if (value.length>200) return "关键词最多可输入 200 个字符。";
  if (value.includes("\0")) return "关键词包含无效字符。";
  if (searchWords(value).length>6) return "最多输入 6 个关键词，请减少后再筛选。";
  return "";
}

export async function loader({request}:LoaderFunctionArgs) {
  const query=new URLSearchParams(new URL(request.url).search);
  query.delete("_routes");
  query.delete("index");
  for (const [key,value] of [...query]) if (!value.trim()) query.delete(key);
  const keywords=query.get("q")??"";
  const error=keywordError(keywords);
  if (error) {
    query.delete("q");
    query.delete("cursor");
  }
  const library=await adminGet<ReaderLibrary>(request,"/api/admin/reader/library?"+query);
  return {...library,query:Object.fromEntries(query),keywords,keywordError:error};
}

const inputStyle="min-h-11 rounded-control border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-accent";
const control=inputStyle+" mt-1 block w-full min-w-0";
const action="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4";
const keywordForm="library-keyword-search";
const extraFilters=[
  {name:"starred",label:"收藏",width:"w-24",options:[["true","已收藏"],["false","未收藏"]]},
  {name:"status",label:"阅读状态",width:"w-28",options:[["to-read","待读"],["reading","在读"],["read","已读"]]},
  {name:"hasNote",label:"笔记",width:"w-24",options:[["true","有笔记"],["false","无笔记"]]},
];
// The main controls and gaps use 44.25rem. Allow some extra room at each step.
const extraFilterWidths=[52,60,67];
const sortOptions=[
  {value:"collected",label:"收录时间（从新到旧）",shortLabel:"最新收录"},
  {value:"note-updated",label:"笔记最近更新",shortLabel:"笔记更新"},
];

function LibrarySort({sort,onChange}:{sort:string;onChange:(sort:string)=>void}) {
  const current=sortOptions.find(option=>option.value===sort)??sortOptions[0]!;
  const label=`排序 · ${current.shortLabel}`;
  return <Menu label={label} triggerClassName="group inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-control border border-line bg-surface px-3 text-sm text-accent hover:bg-bg-sunk focus-visible:outline-2 focus-visible:outline-accent data-[state=open]:bg-accent/10"
    trigger={<><IconFilter size={16}/><span>{label}</span>
      <IconChevronDown size={16} className="group-data-[state=open]:rotate-180"/>
    </>}>
    {()=> <DropdownMenu.RadioGroup className="w-56 max-w-full px-1.5" value={current.value} onValueChange={value=>{if(value!==current.value)onChange(value);}}>
      {sortOptions.map(option=><DropdownMenu.RadioItem key={option.value} value={option.value}
        className="flex min-h-10 cursor-default select-none items-center justify-between gap-2 rounded-mark px-2.5 text-sm outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-inset data-[highlighted]:ring-accent data-[state=checked]:bg-accent/10 data-[state=checked]:font-medium data-[state=checked]:text-accent">
        {option.label}
        <DropdownMenu.ItemIndicator><IconCheck size={16}/></DropdownMenu.ItemIndicator>
      </DropdownMenu.RadioItem>)}
    </DropdownMenu.RadioGroup>}
  </Menu>;
}

function KeywordSearch({page,onApply}:{
  page:Awaited<ReturnType<typeof loader>>;
  onApply:(changes:Record<string,string>)=>void;
}) {
  const [error,setError]=useState(page.keywordError);
  const keywords=useRef<HTMLInputElement>(null);
  function validate(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input=keywords.current;
    if (!input) return;
    const message=keywordError(input.value);
    setError(message);
    if (message) input.focus();
    else onApply({q:input.value.trim()});
  }
  return <Form id={keywordForm} role="search" method="get" action="/admin/reader" onSubmit={validate} className="w-56 max-w-full">
    {["limit","sort","dateField","dateFrom","dateTo"].map(key=>page.query[key]&&<input key={key} type="hidden" name={key} value={page.query[key]}/>)}
    <label htmlFor="library-keywords" className="block text-sm font-medium">关键词</label>
    <input ref={keywords} id="library-keywords" type="search" name="q" defaultValue={page.keywords}
      maxLength={200} enterKeyHint="search" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      placeholder="搜索私人书库" onChange={()=>{if (error) setError("");}}
      aria-invalid={error?true:undefined} aria-describedby={error?"library-keyword-error library-search-help":"library-search-help"}
      className={control+" aria-invalid:border-hot"}/>
    {error&&<p id="library-keyword-error" role="alert" className="mt-2 text-sm text-hot">{error}</p>}
  </Form>;
}

function LibrarySearch({page}:{page:Awaited<ReturnType<typeof loader>>}) {
  const location=useLocation(),navigation=useNavigation(),navigationType=useNavigationType(),navigate=useNavigate();
  const [draftRevision,setDraftRevision]=useState(0),previousLocation=useRef(location.key);
  const toolbar=useRef<HTMLDivElement>(null),more=useRef<HTMLDetailsElement>(null);
  const [visibleExtras,setVisibleExtras]=useState(0),lastVisible=useRef(0);
  const movedFocus=useRef<{name:string;previous:Element}|null>(null);
  useLayoutEffect(()=>{
    const row=toolbar.current!;
    const measure=()=>{
      const rem=Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const next=extraFilterWidths.filter(width=>width*rem<=row.clientWidth).length;
      const previous=lastVisible.current;
      if(next===previous)return;
      const focused=document.activeElement;
      if(focused instanceof HTMLSelectElement&&focused.form?.id===keywordForm){
        const index=extraFilters.findIndex(filter=>filter.name===focused.name);
        if(index>=Math.min(previous,next)&&index<Math.max(previous,next))movedFocus.current={name:focused.name,previous:focused};
      }else if(focused&&next===extraFilters.length&&focused===more.current?.querySelector("summary")){
        movedFocus.current={name:extraFilters[previous]!.name,previous:focused};
      }
      lastVisible.current=next;
      setVisibleExtras(next);
    };
    const observer=new ResizeObserver(measure);
    observer.observe(row);
    measure();
    return ()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{
    const move=movedFocus.current;
    movedFocus.current=null;
    if(!move||(document.activeElement!==document.body&&document.activeElement!==move.previous))return;
    const control=document.querySelector<HTMLSelectElement>(`select[form="${keywordForm}"][name="${move.name}"]`);
    if(!control)return;
    if(more.current?.contains(control))more.current.open=true;
    control.focus({preventScroll:true});
  },[visibleExtras]);
  // Filter changes preserve independent drafts. History, clearing and opening views restore applied values.
  useLayoutEffect(()=>{
    if (previousLocation.current===location.key) return;
    previousLocation.current=location.key;
    if (navigationType==="POP"||!location.state?.libraryFilter) setDraftRevision(value=>value+1);
  },[location.key,location.state,navigationType]);
  const pending=navigation.location;
  const query=new URLSearchParams(pending?.pathname==="/admin/reader"&&pending.state?.libraryFilter?pending.search:page.query);
  function apply(changes:Record<string,string>) {
    const next=new URLSearchParams(query);
    next.delete("cursor");
    for (const [key,value] of Object.entries(changes)) {
      if (value) next.set(key,value);
      else next.delete(key);
    }
    if (!next.has("dateFrom")&&!next.has("dateTo")) next.delete("dateField");
    void navigate({pathname:"/admin/reader",search:next.toString()},{preventScrollReset:true,state:{libraryFilter:true}});
  }
  const select=(name:string)=>({
    name,form:keywordForm,className:control,value:query.get(name)??"",
    onChange:(event:ChangeEvent<HTMLSelectElement>)=>apply({[name]:event.currentTarget.value}),
  });
  const secondary=extraFilters.map(({name,label,width,options})=><label key={name} className={width+" max-w-full text-sm"}>
    {label}<select {...select(name)}><option value="">全部</option>{options.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select>
  </label>);
  return <div className="mt-5" aria-busy={navigation.state!=="idle"}>
    <div ref={toolbar} role="group" aria-label="筛选私人文章" className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <KeywordSearch key={draftRevision} page={page} onApply={apply}/>
      <label className="w-36 max-w-full text-sm">来源<select {...select("sourceId")}><option value="">全部来源</option>{page.filters.sources.map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
      <label className="w-40 max-w-full text-sm">主题<select {...select("topic")}><option value="">全部主题</option>{page.filters.topics.map(topic=><option key={topic.slug} value={topic.slug}>{topic.name}</option>)}</select></label>
      <label className="w-36 max-w-full text-sm">类别<select {...select("category")}><option value="">全部类别</option>{page.filters.categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      {secondary.slice(0,visibleExtras)}
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
      <p id="library-search-help" className="text-sm text-ink-3">按 Enter 搜索标题、摘要、已保存正文和私人笔记，最多 6 个词，均需命中。</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link to="/admin/reader" className={action}>清除筛选</Link>
        <LibraryDates key={draftRevision} query={page.query} onApply={apply}/>
        <LibrarySort sort={query.get("sort")??"collected"} onChange={sort=>apply({sort})}/>
      </div>
    </div>
    {visibleExtras<secondary.length&&<details ref={more}>
      <summary className="min-h-11 w-fit cursor-pointer py-3 text-sm font-medium text-accent">更多筛选</summary>
      <div className="flex flex-wrap gap-3 pb-3">{secondary.slice(visibleExtras)}</div>
    </details>}
  </div>;
}

export default function LibraryPage() {
  const page=useLoaderData<typeof loader>(),busy=useNavigation().state!=="idle";
  const reviewQuery=new URLSearchParams();
  for (const key of readerViewQueryKeys) if (page.query[key]) reviewQuery.set(key,page.query[key]!);
  reviewQuery.set("hasNote","true");
  reviewQuery.set("sort","note-updated");
  const firstPageQuery=new URLSearchParams(page.query);
  firstPageQuery.delete("cursor");
  const firstPageHref="/admin/reader"+(firstPageQuery.size?"?"+firstPageQuery:"");
  const hasCursor=!!page.query.cursor;
  return <section className="mx-auto max-w-7xl px-5 py-7">
    <div className="flex flex-wrap items-center justify-between gap-x-5">
      <h1 className="text-2xl font-semibold">{page.query.hasNote==="true"&&page.query.sort==="note-updated"?"私人笔记回顾":"私人书库"}</h1>
      <div className="flex flex-wrap gap-x-5">
        <Link to={"/admin/reader?"+reviewQuery} className={action}>笔记回顾</Link>
        <Link to="/admin/reader/taxonomy#topics" className={action}>管理主题</Link>
      </div>
    </div>
    <LibrarySearch page={page}/>
    <details>
      <summary className="min-h-11 w-fit cursor-pointer py-3 text-sm font-medium text-accent">常用视图</summary>
      <SavedViews query={page.query} catalog={page.filters}/>
    </details>
    <p className="mb-3 mt-2 break-words text-sm text-ink-3">当前已应用条件：{describeLibraryQuery(page.query,page.filters)}</p>
    <LibraryOrganizer key={JSON.stringify(page.query)} items={page.items} filters={page.filters} navigating={busy}
      returnSearch={librarySearch(new URLSearchParams(page.query).toString())} hasCursor={hasCursor}/>
    {(hasCursor||page.nextCursor)&&<nav aria-label="书库分页" className="mt-3 flex flex-wrap gap-x-6">
      {hasCursor&&<Link className={action} to={firstPageHref}>回到筛选结果首页</Link>}
      {page.nextCursor&&<Link className={action} to={"/admin/reader?"+new URLSearchParams({...page.query,cursor:page.nextCursor})}>{page.query.sort==="note-updated"?"下一页":"更早的文章"}</Link>}
    </nav>}
  </section>;
}
