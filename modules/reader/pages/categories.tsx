import {useEffect,useId,useRef,useState} from "react";
import {useLoaderData,type LoaderFunctionArgs} from "react-router";
import {adminGet} from "../../../apps/web/app/lib/admin.server.ts";
import {OwnerRequestError,ownerRequest} from "../client.ts";
import {
  mergeTaxonomyCatalog,primaryTaxonomyButton,secondaryTaxonomyButton,taxonomyInput,
  useTaxonomyCommand,useTaxonomyDraft,useTaxonomyDraftGuard,type TrackTaxonomyDraft,
} from "../components/TaxonomyForms.ts";

type Category={id:string;name:string;version:number};
const catalog="/api/site/categories";
const commands="/api/admin/categories";
export const headers=()=>({"Cache-Control":"no-store"});
export const shouldRevalidate=()=>true;
export async function loader({request}:LoaderFunctionArgs){
  return adminGet<{items:Category[]}>(request,catalog);
}

function NewCategory({track,onSaved,onRefresh}:{
  track:TrackTaxonomyDraft;onSaved:(value:Category)=>void;onRefresh:(items:Category[])=>void;
}){
  const [name,setName]=useState("");
  const inputId=useId(),input=useRef<HTMLInputElement>(null),command=useTaxonomyCommand(input);
  useTaxonomyDraft(track,inputId,name!=="");
  return <form method="post" action="/admin/reader/categories" aria-label="新增分类" aria-busy={!!command.pending}
    className="mt-5 rounded-panel border border-line bg-surface p-4" onSubmit={event=>{
      event.preventDefault();
      void command.run("save",async()=>{
        const value=await ownerRequest<Category>(commands,"POST",{name});
        onSaved(value);setName("");
        return "分类已新增";
      });
    }}>
    <label htmlFor={inputId} className="mb-2 block font-medium">新增分类</label>
    <fieldset disabled={!!command.pending} className="flex min-w-0 flex-wrap items-center gap-2">
      <input id={inputId} ref={input} name="name" className={taxonomyInput+" w-72 max-w-full"} maxLength={60}
        autoComplete="off" required value={name} onChange={event=>{setName(event.target.value);command.clearFeedback();}}/>
      <button type="submit" className={primaryTaxonomyButton}>{command.pending==="save"?"新增中…":"新增"}</button>
    </fieldset>
    {(command.error||command.pending==="read")&&<div className="mt-2 flex flex-wrap items-center gap-2">
      {command.error&&<p role="alert" className="text-hot">{command.error}</p>}
      <button type="button" className={secondaryTaxonomyButton} disabled={!!command.pending} onClick={()=>void command.run("read",async()=>{
        const {items}=await ownerRequest<{items:Category[]}>(catalog);
        onRefresh(items);
        return "已刷新分类列表，输入已保留。";
      })}>{command.pending==="read"?"核对中…":"核对分类列表"}</button>
    </div>}
    {command.message&&<p role="status" className="mt-2 text-sm text-ink-3">{command.message}</p>}
  </form>;
}

function CategoryRow({category,track,onSaved}:{category:Category;track:TrackTaxonomyDraft;onSaved:(value:Category)=>void}){
  const [editing,setEditing]=useState(false),[base,setBase]=useState(category),[name,setName]=useState(category.name);
  const [comparison,setComparison]=useState<Category|null>(null);
  const input=useRef<HTMLInputElement>(null),editButton=useRef<HTMLButtonElement>(null),form=useRef<HTMLFormElement>(null);
  const restoreFocus=useRef(false),command=useTaxonomyCommand(input);
  const dirty=editing&&name.trim()!==base.name;
  useTaxonomyDraft(track,category.id,editing&&name!==base.name);
  useEffect(()=>{
    if(editing)input.current?.focus({preventScroll:true});
    else if(restoreFocus.current){restoreFocus.current=false;editButton.current?.focus({preventScroll:true});}
  },[editing]);
  const closeEditor=()=>{
    const focused=document.activeElement;
    restoreFocus.current=focused===document.body||!!form.current?.contains(focused);
    setEditing(false);setComparison(null);
  };
  return <li className="px-4 py-2">
    {!editing?<div className="flex items-center justify-between gap-3">
      <span className="min-w-0 break-words font-medium">{category.name}</span>
      <button ref={editButton} type="button" className={secondaryTaxonomyButton} aria-label={"改名 "+category.name}
        onClick={()=>{setBase(category);setName(category.name);command.clearFeedback();setEditing(true);}}>改名</button>
    </div>:<form ref={form} method="post" action="/admin/reader/categories" aria-busy={!!command.pending} onSubmit={event=>{
      event.preventDefault();
      if(!dirty)return;
      void command.run("save",async()=>{
        const value=await ownerRequest<Category>(commands+"/"+encodeURIComponent(category.id),"PATCH",{name,expectedVersion:base.version});
        onSaved(value);closeEditor();
        return "分类已保存";
      });
    }}>
      <fieldset disabled={!!command.pending} className="flex min-w-0 flex-wrap items-center gap-2">
        <input ref={input} aria-label={"分类名称："+category.name} name="name" className={taxonomyInput+" w-72 max-w-full"}
          maxLength={60} autoComplete="off" required value={name} onChange={event=>{setName(event.target.value);command.clearFeedback();}}/>
        <button type="submit" className={primaryTaxonomyButton} disabled={!dirty}>{command.pending==="save"?"保存中…":"保存"}</button>
        <button type="button" className={secondaryTaxonomyButton} onClick={()=>{command.clearFeedback();closeEditor();}}>取消</button>
        {(command.error||command.pending==="read")&&<button type="button" className={secondaryTaxonomyButton}
          onClick={()=>void command.run("read",async()=>{
            const {items}=await ownerRequest<{items:Category[]}>(catalog);
            const value=items.find(item=>item.id===category.id);
            if(!value)throw new OwnerRequestError(404,"找不到此分类");
            setBase(value);setComparison(value);onSaved(value);
            return "已核对，输入已保留。";
          })}>{command.pending==="read"?"核对中…":"核对已保存版本"}</button>}
      </fieldset>
      {command.error&&<p role="alert" className="mt-2 text-sm text-hot">{command.error}</p>}
      {comparison&&<p className="mt-2 break-words text-sm text-ink-3">已保存名称：{comparison.name}</p>}
    </form>}
    {command.message&&<p role="status" className="mt-2 text-sm text-ink-3">{command.message}</p>}
  </li>;
}

export default function Categories(){
  const loaded=useLoaderData<typeof loader>(),[items,setItems]=useState(loaded.items),track=useTaxonomyDraftGuard();
  const updateCatalog=(snapshot:Category[])=>setItems(current=>mergeTaxonomyCatalog(current,snapshot,item=>item.id));
  useEffect(()=>{updateCatalog(loaded.items);},[loaded.items]);
  const accept=(value:Category)=>setItems(current=>current.some(item=>item.id===value.id)
    ?current.map(item=>item.id===value.id&&item.version<=value.version?value:item)
    :[...current,value]);
  return <section className="mx-auto max-w-4xl px-5 py-8">
    <h1 className="text-2xl font-semibold">分类管理</h1>
    <p className="mt-2 text-sm text-ink-3">先收录文章，再逐步整理分类。每篇文章只分配一个主分类。</p>
    <NewCategory track={track} onSaved={accept} onRefresh={updateCatalog}/>
    <h2 className="mb-3 mt-6 text-lg font-semibold">已有分类</h2>
    <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
      {items.map(category=><CategoryRow key={category.id} category={category} track={track} onSaved={accept}/>)}
    </ul>
  </section>;
}
