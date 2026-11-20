import {load} from 'cheerio';
import {collapseWhitespace} from '../lib/text.ts';
const publisherId=/^[\p{L}\p{N}_.:-]{1,180}$/u;

/** Text fragments use verbatim publisher words. A short visible excerpt also works with browser Find. */
function locatorText(text:string):string {
  const normalized=collapseWhitespace(text);
  if(normalized.length<=100)return normalized;
  const prefix=normalized.slice(0,100);
  const sentence=/^.*?[。！？]|^.*?[.!?](?=\s)/u.exec(prefix);
  if(sentence)return sentence[0];
  const boundary=prefix.lastIndexOf(' ');
  return boundary>40?prefix.slice(0,boundary):Array.from(normalized).slice(0,50).join('');
}

export function locateArticleFigures(html:string,url:string,originalHtml?:string):string{
  if(!html.includes('data-reader-figure-status="missing"'))return html;
  let page:URL;
  try{page=new URL(url);}catch{return html;}
  if(!['http:','https:'].includes(page.protocol))return html;
  page.hash='';
  const $=load(html,null,false),source=originalHtml===undefined?$:load(originalHtml,null,false);
  const figures=$('figure').toArray(),original=source('figure').toArray();
  // Translation preserves the figure tree. Decline to pair two differently structured snapshots.
  const paired=figures.length===original.length&&figures.every((node,i)=>
    $(node).parents('figure').length===source(original[i]).parents('figure').length
    &&!!$(node).children('figcaption').length===!!source(original[i]).children('figcaption').length);
  if(!paired)return html;
  let heading='';
  const headings=new Map(original.map(node=>[node,'']));
  source('h1,h2,h3,h4,h5,h6,figure').each((_,node)=>{
    if(node.name==='figure')headings.set(node,heading);
    else if(!source(node).parents('figure').length)heading=source(node).text();
  });
  let changed=false;
  for(const [index,node] of figures.entries()){
    const figure=$(node);if(figure.attr('data-reader-figure-status')!=='missing')continue;
    const link=figure.children('p').children('a').filter((_,a)=>$(a).text()==='此图未保存，查看原文').first();
    if(!link.length)continue;
    const from=source(original[index]),id=from.attr('data-reader-source-id');
    const caption=from.children('figcaption').first(),shown=figure.children('figcaption').first();
    const label=locatorText(caption.find('p,h2,h3,h4').first().text()||caption.text()||headings.get(original[index]!)||'');
    const target=new URL(page);
    const existing=from.children('p').children('a').filter((_,a)=>source(a).text()==='此图未保存，查看原文').first().attr('href');
    if(existing&&URL.canParse(existing,page)){
      const old=new URL(existing,page),fragment=old.hash;old.hash='';
      if(old.href===page.href&&!fragment.includes(':~:'))target.hash=fragment;
    }
    if(id&&publisherId.test(id))target.hash=encodeURIComponent(id);
    if(!target.hash){
      const section=from.attr('data-reader-source-section');
      const anchor=section&&publisherId.test(section)?encodeURIComponent(section):'';
      target.hash=anchor+(label?':~:text='+encodeURIComponent(label).replaceAll('-','%2D'):'');
    }
    if(!target.hash)continue;
    link.attr('href',target.href);
    if(label){
      link.attr('aria-label','查看原文图示：'+label);
      if(!collapseWhitespace(shown.text()).includes(label)&&!link.next('.reader-figure-locator').length){
        link.after($('<span>').addClass('reader-figure-locator').text('原文定位词：'+label));
      }
    }
    changed=true;
  }
  return changed?$.html():html;
}
