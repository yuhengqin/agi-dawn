import {useState} from "react";
import {Link} from "react-router";
import type {Route} from "./+types/content-item";
import type {AdminContentChain} from "@agidawn/contracts/admin";
import {adminGet} from "../../lib/admin.server";
import {useAdminAction} from "../../features/admin/action";
import {AdminPage,Button,Card,Input,Json,Time} from "../../features/admin/ui";
export const loader=({request,params}:Route.LoaderArgs)=>adminGet<AdminContentChain>(request,"/api/admin/content/"+params.id);
export const headers=()=>({"Cache-Control":"no-store"});
export const shouldRevalidate=()=>true;
export default function ContentItem({loaderData:chain}:Route.ComponentProps){
  const {run,busy}=useAdminAction(),[reason,setReason]=useState(""),article=chain.article,publication=chain.publication,version=chain.override?.version??0;
  return <AdminPage title={article.title} subtitle={article.id}>
    <div className="mb-5 flex flex-wrap gap-5 text-sm text-accent"><Link to={"/admin/sources/"+article.source_id}>来源：{article.source_name}</Link><Link to={"/items/"+article.id}>公开页面</Link><a href={article.url} target="_blank" rel="noreferrer">原文</a><Link to={"/admin/reader/articles/"+article.id}>笔记、分类与归档版本</Link></div>
    <div className="grid gap-5 xl:grid-cols-2"><Card title="公开状态">
      <p className="mb-4 text-sm text-ink-3">当前：{publication?.visibility??"尚未发布"} · {article.site_fulltext?"来源允许全文":"来源只展示摘要和链接"}</p>
      <label className="block text-sm">修改原因<Input className="mt-2" required value={reason} onChange={event=>setReason(event.target.value)} placeholder="说明更正或下架原因"/></label>
      <div className="mt-4 flex flex-wrap gap-3">{[{visibility:"public",name:"公开"},{visibility:"summary-only",name:"仅摘要"},{visibility:"withdrawn",name:"下架"}].map(value=><Button key={value.visibility} disabled={busy||!reason.trim()} onClick={()=>run("POST","/api/admin/content/"+article.id+"/visibility",{visibility:value.visibility,version,reason},{success:"公开状态已更新"})}>{value.name}</Button>)}</div>
      <p className="mt-4 text-sm text-ink-3">下架决定会保留；重新采集或重新提取正文不会自动恢复。</p>
    </Card><Card title="正文处理"><p className="text-sm">状态：{article.body_status} · 修订 {article.body_revision??"无"} · {article.processing_state}</p>
      {article.processing_error&&<p className="my-3 break-words text-sm text-hot">{article.processing_error}</p>}
      {article.body_issues.map((issue,i)=><p className="my-2 text-sm" key={i}>{issue.message}</p>)}
      <p className="my-4 text-sm text-ink-3">重新提取失败时保留最后可用正文。已配置的付费提取服务受后台预算限制。</p>
      <Button disabled={busy} onClick={()=>run("POST","/api/admin/content/"+article.id+"/rerun",{step:"extract"},{success:"正文任务已排队"})}>重新提取正文</Button>
    </Card></div>
    <Card className="mt-5" title="人工修正"><form className="space-y-4" key={version} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);void run("POST","/api/admin/content/"+article.id+"/override",{version,reason:form.get("reason"),fields:{title:form.get("title"),summary:form.get("summary"),tags:String(form.get("tags")??"").split(",").map(value=>value.trim()).filter(Boolean)}},{success:"修正已保存"});}}>
      <label className="block text-sm">标题<Input className="mt-2" name="title" maxLength={300} required defaultValue={publication?.title??article.title}/></label>
      <label className="block text-sm">来源摘要<textarea className="mt-2 min-h-24 w-full rounded-control border border-line bg-surface p-3" name="summary" maxLength={2000} defaultValue={publication?.summary??""}/></label>
      <label className="block text-sm">主题标签（逗号分隔）<Input className="mt-2" name="tags" defaultValue={publication?.tags.join(", ")??""}/></label>
      <label className="block text-sm">修改原因<Input className="mt-2" name="reason" required/></label><Button type="submit" disabled={busy}>保存修正</Button>
    </form></Card>
    <Card className="mt-5" title="材料与操作记录"><p className="mb-4 text-sm">首次收录：<Time at={article.discovered_at}/> · 原文时间：<Time at={article.published_at}/></p><Json value={{discoveries:chain.discoveries,revisions:chain.revisions,override:chain.override,history:chain.history}} label="查看诊断记录"/></Card>
  </AdminPage>;
}
