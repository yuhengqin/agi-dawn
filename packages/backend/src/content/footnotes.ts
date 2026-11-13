import * as cheerio from 'cheerio';
import type {Element} from 'domhandler';

export const FOOTNOTE_ID=/^reader-fn-(?:target-\d{1,5}|ref-\d{1,5}-\d{1,5})$/;
const identity=(id:string)=>{const m=/^footnote(-anchor)?-?([1-9]\d{0,4})$/.exec(id);return m?{back:!!m[1],n:Number(m[2])}:null;};

/** Restore only proven same-document footnote targets; missing or cross-document targets stay external. */
export function restoreFootnotes(html:string,baseUrl?:string):string{
  if(!baseUrl||!html.includes('footnote'))return html;
  let page:URL;try{page=new URL(baseUrl);}catch{return html;}
  const $=cheerio.load(html,null,false),targets=new Map<number,Element>(),ambiguous=new Set<number>();
  const assign=(n:number,node:Element)=>{if(targets.has(n)&&targets.get(n)!==node){targets.delete(n);ambiguous.add(n);}else if(!ambiguous.has(n))targets.set(n,node);};
  $('[id]').each((_,node)=>{const id=identity($(node).attr('id')!);if(id&&!id.back)assign(id.n,node);});
  const same=(href:string)=>{try{const url=new URL(href,page);return url.origin===page.origin&&url.pathname.replace(/\/$/,'')===page.pathname.replace(/\/$/,'')
    &&url.search===page.search?identity(decodeURIComponent(url.hash.slice(1))):null;}catch{return null;}};
  const links=$('a[href]').toArray(),backs=new Map<number,Element[]>();
  for(const node of links){const id=same($(node).attr('href')!);if(id?.back){const found=backs.get(id.n)??[];found.push(node);backs.set(id.n,found);}}
  if(page.hostname==='blog.sshh.io')for(const [n,nodes] of backs)if(nodes.length===1&&!targets.has(n))assign(n,nodes[0]!);
  if(page.hostname==='blogs.microsoft.com')$('p').each((_,node)=>{
    const first=$(node).contents().toArray().find(child=>child.type!=='text'||!!child.data.trim());
    if(first?.type!=='tag'||first.name!=='sup'||$(first).find('a').length)return;
    const value=$(first).text().trim();if(/^[1-9]\d{0,4}$/.test(value))assign(Number(value),node);
  });
  let changed=false;const refs=new Map<number,Element[]>();
  for(const node of links){const id=same($(node).attr('href')!);if(!id||id.back||!targets.has(id.n)||!/^\[?\d+\]?$/.test($(node).text().trim()))continue;
    const found=refs.get(id.n)??[];found.push(node);refs.set(id.n,found);
    $(node).attr({id:`reader-fn-ref-${id.n}-${found.length}`,href:`#reader-fn-target-${id.n}`});changed=true;
  }
  for(const [n,nodes] of refs){
    const target=targets.get(n)!;$(target).attr('id',`reader-fn-target-${n}`);
    const returns=backs.get(n)??[];
    if(returns.length)for(const back of returns)$(back).attr('href',`#reader-fn-ref-${n}-1`);
    else if(page.hostname==='blogs.microsoft.com')nodes.forEach((node,index)=>$(target).append(' ',$('<a>').attr({href:`#reader-fn-ref-${n}-${index+1}`,title:`返回引用 ${$(node).text().trim()}`}).text('↩')));
  }
  return changed?$.html():html;
}
