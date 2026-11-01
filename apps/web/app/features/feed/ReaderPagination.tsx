import {Form,Link,useSubmit} from 'react-router';
import {READER_PAGE_SIZES} from '@agidawn/contracts/site';
import type {ReaderPageData} from './reader.server';
import {PreservedFilters} from './ReaderFilters';
import {readerLink} from './ReaderNavigation';
import {IconChevronLeft,IconChevronRight} from '../../components/icons';

type PaginationProps=Pick<ReaderPageData,'page'|'query'>;

export function ReaderListSummary({page}:Pick<ReaderPageData,'page'>){
  const start=(page.page-1)*page.limit+1,end=start+page.items.length-1;
  return <p role="status" aria-label="文章分页信息" className="py-3 text-xs text-ink-3">共 {page.total} 篇{page.total>0&&<span className="ml-3">第 {start}–{end} 篇</span>}</p>;
}

export function ReaderPagination({page,query}:PaginationProps){
  const submit=useSubmit(),start=(page.page-1)*page.limit+1,end=start+page.items.length-1;
  const href=(number:number)=>readerLink(query,{page:number===1?null:String(number)});
  const numbers=page.pageCount<=9?Array.from({length:page.pageCount},(_,index)=>index+1):[
    1,...Array.from({length:page.page<=4||page.page>=page.pageCount-3?6:5},(_,index)=>
      page.page<=4?index+2:page.page>=page.pageCount-3?page.pageCount-6+index:page.page-2+index),page.pageCount,
  ];
  const entries:Array<number|string>=[];
  for(const number of numbers){
    const previous=entries.at(-1);
    if(typeof previous==='number'&&number-previous===2)entries.push(previous+1);
    else if(typeof previous==='number'&&number-previous>2)entries.push('gap-'+number);
    entries.push(number);
  }
  return <div className="reader-pagination">
    {page.pageCount>1&&<nav aria-label="文章分页" className="reader-pagination-nav">
      {page.page>1?<Link to={href(page.page-1)} rel="prev" aria-label="上一页" className="reader-page-control"><IconChevronLeft size={16}/><span className="sr-only sm:not-sr-only">上一页</span></Link>:<span aria-disabled="true" aria-label="上一页" className="reader-page-control"><IconChevronLeft size={16}/><span className="sr-only sm:not-sr-only">上一页</span></span>}
      {entries.map(entry=>typeof entry==='number'?<Link key={entry} to={href(entry)} aria-label={`第 ${entry} 页`} aria-current={entry===page.page?'page':undefined} className="reader-page-control">{entry}</Link>:<span key={entry} className="reader-page-gap" aria-hidden="true">…</span>)}
      {page.page<page.pageCount?<Link to={href(page.page+1)} rel="next" aria-label="下一页" className="reader-page-control"><span className="sr-only sm:not-sr-only">下一页</span><IconChevronRight size={16}/></Link>:<span aria-disabled="true" aria-label="下一页" className="reader-page-control"><span className="sr-only sm:not-sr-only">下一页</span><IconChevronRight size={16}/></span>}
    </nav>}
    <div role="group" aria-label="文章分页控制" className="reader-pagination-controls">
      <p className="reader-pagination-total">{page.total>0&&<>第 {start}–{end} 篇<span className="mx-2 text-ink-4">/</span></>}共 {page.total} 篇</p>
      <Form method="get" action="/" className="reader-pagination-size" key={page.limit}>
        <PreservedFilters query={query} except={['limit']}/>
        <label htmlFor="reader-page-size">每页</label>
        <select id="reader-page-size" name="limit" aria-label="每页篇数" defaultValue={page.limit} className="reader-pagination-field" onChange={event=>void submit(event.currentTarget.form)}>
          {READER_PAGE_SIZES.map(size=><option key={size} value={size}>{size} 篇</option>)}
        </select>
        <noscript><button type="submit" className="reader-pagination-submit">应用数量</button></noscript>
      </Form>
      {page.pageCount>1&&<Form method="get" action="/" key={JSON.stringify(query)} className="reader-pagination-jump">
        <PreservedFilters query={query} except={[]}/>
        <label htmlFor="reader-page-jump">第</label>
        <input id="reader-page-jump" aria-label="跳转页码" type="number" name="page" min={1} max={page.pageCount} step={1} required defaultValue={page.page} inputMode="numeric" enterKeyHint="go" className="reader-pagination-field"/>
        <span className="whitespace-nowrap">/ {page.pageCount} 页</span><button type="submit" className="reader-pagination-submit">跳转</button>
      </Form>}
    </div>
  </div>;
}
