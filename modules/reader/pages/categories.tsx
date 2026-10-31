import {useLoaderData,useRevalidator,type LoaderFunctionArgs} from "react-router";
import {useState} from "react";
import {adminGet} from "../../../apps/web/app/lib/admin.server.ts";
import {ownerRequest} from "../client.ts";
export const headers=()=>({"Cache-Control":"no-store"});
export const shouldRevalidate=()=>true;
export async function loader({request}:LoaderFunctionArgs){return adminGet<{items:Array<{id:string;name:string;version:number}>}>(request,"/api/site/categories");}
export default function Categories(){const {items}=useLoaderData<typeof loader>(),revalidator=useRevalidator(),[name,setName]=useState(""),[error,setError]=useState("");
const save=async(path:string,method:string,body:unknown)=>{setError("");try{await ownerRequest(path,method,body);setName("");await revalidator.revalidate();}catch(error){setError(error instanceof Error?error.message:"保存失败");}};
return <section className="mx-auto max-w-3xl px-5 py-8"><h1 className="text-2xl font-semibold">分类管理</h1><p className="my-3 text-sm text-ink-3">先收录文章，再逐步整理分类。每篇文章只分配一个主分类。</p><form className="my-6 flex gap-3" onSubmit={event=>{event.preventDefault();void save("/api/admin/categories","POST",{name});}}><label className="flex-1">新增分类<input className="ml-3 min-h-11 border border-line bg-surface px-3" maxLength={60} required value={name} onChange={event=>setName(event.target.value)}/></label><button className="px-3 text-accent">新增</button></form>{error&&<p role="alert" className="text-hot">{error}</p>}
<ul className="divide-y divide-line">{items.map(category=><li key={category.id}><form className="flex items-center gap-3 py-4" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void save("/api/admin/categories/"+category.id,"PATCH",{name:data.get("name"),expectedVersion:category.version});}}><input aria-label={"分类名称："+category.name} className="min-h-11 flex-1 border border-line bg-surface px-3" name="name" maxLength={60} defaultValue={category.name} key={category.version} required/><button className="px-3 text-accent">改名</button></form></li>)}</ul></section>;}
