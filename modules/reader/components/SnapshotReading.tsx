import {useRef,useState} from 'react';
import {Link} from 'react-router';
import {ArticleBody} from '../../../apps/web/app/features/item/ArticleBody.tsx';
import {ReadingDisplay} from '../../../apps/web/app/features/item/ReadingDisplay.tsx';
import {ownerRequest} from '../client.ts';
import type {SnapshotView} from '../contracts.ts';
import {useCurrentSection} from '../../../apps/web/app/lib/motion.ts';
import {useContainedScroll} from '../../../apps/web/app/components/ui/Page.tsx';
import {useReadingPosition} from './useReadingPosition.ts';

export default function SnapshotReading({snapshot}:{snapshot:SnapshotView}){
  const [message,setMessage]=useState('');
  const root=useRef<HTMLDivElement>(null),mobile=useRef<HTMLDetailsElement>(null),[open,setOpen]=useState(false);
  const [directory,overscroll]=useContainedScroll<HTMLDivElement>();
  const outline=snapshot.outline??[],[current,go]=useCurrentSection(outline.map(entry=>entry.id),outline.length>0);
  const reading=useReadingPosition(snapshot,root);
  const jump=(id:string)=>{reading.navigate();if(mobile.current)mobile.current.open=false;go(id);const target=document.getElementById(id);target?.setAttribute('tabindex','-1');target?.focus({preventScroll:true});};
  const entries=(label:string)=><nav aria-label={label}><ol className="space-y-1">{outline.map(entry=><li key={entry.id} style={{paddingLeft:(entry.level-2)*12}}><a className={'block min-h-11 py-2 text-sm leading-relaxed '+(current===entry.id?'font-semibold text-accent underline':'text-ink-3 hover:text-ink')} href={'#'+entry.id} aria-current={current===entry.id?'location':undefined} onClick={event=>{event.preventDefault();jump(entry.id);}}>{entry.text}</a></li>)}</ol></nav>;
  const missing=snapshot.resources.filter(resource=>resource.status!=='ready');
  return <>
    <p className="my-3 text-sm text-ink-3">{snapshot.sourceName}{snapshot.author?' · '+snapshot.author:''} · 正文修订 {snapshot.bodyRevision} · {snapshot.status==='complete'?'已完整保存':'不完整归档'}</p>
    <div className="my-5 flex flex-wrap gap-5"><a className="text-accent underline" href={'/api/admin/reader/snapshots/'+snapshot.id+'/export.zip'}>下载此版本 ZIP</a><a className="text-accent underline" href={snapshot.originalUrl} target="_blank" rel="noreferrer">对照原文</a>{missing.length>0&&<button className="text-accent underline" onClick={async()=>{try{await ownerRequest('/api/admin/reader/snapshots/'+snapshot.id+'/retry','POST',{});setMessage('已排队，稍后刷新查看。');}catch(error){setMessage(error instanceof Error?error.message:'重试失败');}}}>重试缺失图片</button>}</div>
    {message&&<p role="status">{message}</p>}{snapshot.issues.map((issue,index)=><p className="my-2 text-sm text-ink-3" key={index}>{issue.message}</p>)}
    {snapshot.quality==='partial'&&!missing.length&&<p className="my-3 text-sm text-ink-3">图片已保存，正文仍有图表等内容需要对照原文；重试图片不会修复这些内容。</p>}
    {missing.map((resource,index)=><p className="my-2 break-all text-sm text-ink-3" key={index}>{resource.original_url.startsWith('data:')?'内嵌图片':resource.original_url}：{resource.error??'尚未保存'}</p>)}
    <ReadingDisplay/>
    <div className="my-5 min-h-11 text-sm" aria-label="继续阅读">
      {reading.loading&&<p className="text-ink-3">正在载入阅读位置…</p>}
      {reading.offer?.position&&<button className="min-h-11 rounded-control border border-line px-4 text-accent" onClick={reading.resume}>继续阅读（{Math.round(reading.offer.position.progress*100)}%）</button>}
      {reading.offer?.previous&&<p className="text-ink-3">此正文尚无阅读位置。<Link className="text-accent underline" to={'/admin/reader/snapshots/'+reading.offer.previous.snapshotId}>前往之前阅读的正文版本</Link></p>}
      {reading.error&&<p role="alert" className="text-hot">{reading.error} <button className="min-h-11 text-accent underline" disabled={reading.loading} onClick={reading.reload}>载入阅读位置</button></p>}
      {reading.message&&<p role="status" className="mt-2 text-ink-3">{reading.message}</p>}
    </div>
    <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_200px]">
      <div className="min-w-0">
        {outline.length>0&&<details ref={mobile} onToggle={event=>setOpen(event.currentTarget.open)} className="sticky top-20 z-20 mb-5 border-y border-line bg-bg lg:hidden"><summary aria-label={open?'收起文章目录':'展开文章目录'} className="cursor-pointer truncate py-3 text-sm font-medium">文章目录 · {outline.find(entry=>entry.id===current)?.text??'选择章节'}</summary><div className="absolute inset-x-0 max-h-[55dvh] overflow-y-auto overscroll-contain border border-line bg-bg p-4 shadow-sm">{entries('手机文章目录')}</div></details>}
        <div id="reader-body" ref={root} className="min-w-0"><ArticleBody html={snapshot.bodyHtml}/></div>
      </div>
      <aside className="hidden min-w-0 lg:block"><div ref={directory} className={'sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto '+overscroll}>{outline.length>0&&<><h2 className="mb-3 text-sm font-semibold">文章目录</h2>{entries('文章目录')}</>}</div></aside>
    </div>
  </>;
}
