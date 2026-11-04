import {Form,useSubmit} from 'react-router';
import {READER_PAGE_SIZES} from '@agidawn/contracts/site';
import type {ReaderPageData} from './reader.server';
import {PreservedFilters} from './ReaderFilters';
import {readerLink} from './ReaderNavigation';
import {IconChevronLeft,IconChevronRight} from '../../components/icons';
import {IntentLink} from '../../components/ui/IntentLink';

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

  return <div role="group" aria-label="文章分页控制" className="reader-pagination">
    <div className="reader-pagination-info">
      <Form method="get" action="/" className="reader-pagination-size" key={page.limit}>
        <PreservedFilters query={query} except={['limit']}/>
        <label htmlFor="reader-page-size">每页</label>
        <select id="reader-page-size" name="limit" aria-label="每页篇数" defaultValue={page.limit} className="reader-pagination-field" onChange={event=>void submit(event.currentTarget.form)}>
          {READER_PAGE_SIZES.map(size=><option key={size} value={size}>{size} 篇</option>)}
        </select>
        <noscript><button type="submit" className="reader-pagination-submit">应用数量</button></noscript>
      </Form>
      <p className="reader-pagination-total">{page.total>0&&<>第 {start}–{end} 篇<span className="mx-2 text-ink-4">/</span></>}共 {page.total} 篇</p>
    </div>
    {page.pageCount>1&&<div className="reader-pagination-actions">
      <nav aria-label="文章分页" className="reader-pagination-nav" onKeyDown={event=>{
        if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.nativeEvent.isComposing)return;
        const rel=event.key==='ArrowLeft'||event.key==='h'?'prev':event.key==='ArrowRight'||event.key==='l'?'next':null;
        const link=rel&&event.currentTarget.querySelector<HTMLAnchorElement>(`a[rel="${rel}"]`);
        if(link){
          event.preventDefault();
          // The destination page survives when a previous/next or gap link disappears.
          Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('a')).find(candidate=>candidate!==link&&candidate.href===link.href)?.focus({preventScroll:true});
          link.click();
        }
      }}>
        {page.page>1?<IntentLink to={href(page.page-1)} rel="prev" aria-label="上一页" title="上一页（分页链接聚焦时：← 或 h）" className="reader-page-control"><IconChevronLeft size={16}/><span className="sr-only">上一页</span></IntentLink>:<span aria-disabled="true" aria-label="上一页" className="reader-page-control"><IconChevronLeft size={16}/><span className="sr-only">上一页</span></span>}
        {entries.map(entry=>{
          if(typeof entry==='number'){
            return <IntentLink key={entry} to={href(entry)} aria-label={`第 ${entry} 页`} aria-current={entry===page.page?'page':undefined} className="reader-page-control">{entry}</IntentLink>;
          }
          const nextNumber=Number(entry.replace('gap-',''));
          const isBefore=nextNumber<=page.page;
          const target=isBefore?Math.max(1,Math.min(page.page-5,nextNumber-1)):Math.min(page.pageCount,Math.max(page.page+5,(numbers[numbers.indexOf(nextNumber)-1]??0)+1));
          const label=isBefore?`向前跳转至第 ${target} 页`:`向后跳转至第 ${target} 页`;
          return <IntentLink key={entry} to={href(target)} aria-label={label} title={label} className="reader-page-control reader-page-gap">
            <span className="reader-gap-dots" aria-hidden="true">…</span>
            <span className="reader-gap-jump" aria-hidden="true">{isBefore?'«':'»'}</span>
          </IntentLink>;
        })}
        {page.page<page.pageCount?<IntentLink to={href(page.page+1)} rel="next" aria-label="下一页" title="下一页（分页链接聚焦时：→ 或 l）" className="reader-page-control"><span className="sr-only">下一页</span><IconChevronRight size={16}/></IntentLink>:<span aria-disabled="true" aria-label="下一页" className="reader-page-control"><span className="sr-only">下一页</span><IconChevronRight size={16}/></span>}
      </nav>
      {entries.some(entry=>typeof entry==='string')&&<Form method="get" action="/" key={JSON.stringify(query)} className="reader-pagination-jump">
        <PreservedFilters query={query} except={[]}/>
        <label htmlFor="reader-page-jump">第</label>
        <input id="reader-page-jump" aria-label="跳转页码" type="number" name="page" min={1} max={page.pageCount} step={1} required defaultValue={page.page} inputMode="numeric" enterKeyHint="go" onFocus={event=>event.currentTarget.select()} autoComplete="off" className="reader-pagination-field"/>
        <span className="whitespace-nowrap">/ {page.pageCount} 页</span><button type="submit" title="跳转（也可在输入框内直接按回车）" className="reader-pagination-submit">跳转</button>
      </Form>}
    </div>}
  </div>;
}
