import {Form,Link,useSubmit} from 'react-router';
import {READER_PAGE_SIZES} from '@agidawn/contracts/site';
import type {ReaderPageData} from './reader.server';
import {PreservedFilters} from './ReaderFilters';
import {readerLink} from './ReaderNavigation';

type PaginationProps=Pick<ReaderPageData,'page'|'query'>;
const control='inline-flex min-h-11 min-w-11 items-center justify-center rounded-mark px-3 text-sm text-ink-3 hover:bg-bg-sunk hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const field='min-h-11 rounded-mark border border-line bg-surface px-2 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:text-sm';

export function ReaderListSummary({page,query}:PaginationProps){
  const submit=useSubmit(),start=(page.page-1)*page.limit+1,end=start+page.items.length-1;
  return <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-xs text-ink-3">
    <p role="status" aria-label="文章分页信息">共 {page.total} 篇{page.total>0&&<span className="ml-3">第 {start}–{end} 篇</span>}</p>
    <Form method="get" action="/" className="flex items-center gap-2" key={page.limit}>
      <PreservedFilters query={query} except={['limit']}/>
      <label htmlFor="reader-page-size">每页</label>
      <select id="reader-page-size" name="limit" aria-label="每页篇数" defaultValue={page.limit} className={field} onChange={event=>void submit(event.currentTarget.form)}>
        {READER_PAGE_SIZES.map(size=><option key={size} value={size}>{size} 篇</option>)}
      </select>
      <noscript><button type="submit" className={control}>应用数量</button></noscript>
    </Form>
  </div>;
}

export function ReaderPagination({page,query}:PaginationProps){
  if(page.pageCount<2)return null;
  const href=(number:number)=>readerLink(query,{page:number===1?null:String(number)});
  const numbers=[...new Set([1,page.page-1,page.page,page.page+1,...(page.page<=2?[2,3]:[]),...(page.page>=page.pageCount-1?[page.pageCount-2,page.pageCount-1]:[]),page.pageCount])].filter(number=>number>=1&&number<=page.pageCount).sort((a,b)=>a-b);
  const entries:Array<number|string>=[];
  for(const number of numbers){
    const previous=entries.at(-1);
    if(typeof previous==='number'&&number-previous===2)entries.push(previous+1);
    else if(typeof previous==='number'&&number-previous>2)entries.push('gap-'+number);
    entries.push(number);
  }
  return <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
    <nav aria-label="文章分页" className="flex items-center justify-between gap-1 sm:justify-start">
      {page.page>1?<Link to={href(page.page-1)} rel="prev" className={control}>上一页</Link>:<span aria-disabled="true" className="inline-flex min-h-11 items-center px-3 text-sm text-ink-4">上一页</span>}
      <span className="text-xs tabular-nums text-ink-3 sm:hidden">第 {page.page} / {page.pageCount} 页</span>
      <ol className="hidden items-center gap-1 sm:flex">
        {entries.map(entry=><li key={entry}>{typeof entry==='number'?<Link to={href(entry)} aria-label={`第 ${entry} 页`} aria-current={entry===page.page?'page':undefined}
          className={control+' tabular-nums aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-accent-contrast'}>{entry}</Link>:<span className="px-1 text-ink-4">…</span>}</li>)}
      </ol>
      {page.page<page.pageCount?<Link to={href(page.page+1)} rel="next" className={control}>下一页</Link>:<span aria-disabled="true" className="inline-flex min-h-11 items-center px-3 text-sm text-ink-4">下一页</span>}
    </nav>
    <Form method="get" action="/" key={JSON.stringify(query)} className="flex flex-wrap items-center justify-end gap-2 text-xs text-ink-3">
      <PreservedFilters query={query} except={[]}/>
      <span className="hidden sm:inline">共 {page.pageCount} 页</span>
      <label htmlFor="reader-page-jump">前往</label>
      <input id="reader-page-jump" aria-label="跳转页码" type="number" name="page" min={1} max={page.pageCount} step={1} required defaultValue={page.page} inputMode="numeric" className={field+' w-20 tabular-nums'}/>
      <span>页</span><button type="submit" className={control+' border border-line'}>跳转</button>
    </Form>
  </div>;
}
