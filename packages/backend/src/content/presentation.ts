import * as cheerio from 'cheerio';
import {beijingDate} from '@agidawn/contracts/time';
import {collapseWhitespace} from '../lib/text.ts';

const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function dateOnly(value:string):string|null {
  const text=collapseWhitespace(value),chinese=/^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text);
  if(chinese)return `${chinese[1]}-${chinese[2]!.padStart(2,'0')}-${chinese[3]!.padStart(2,'0')}`;
  const english=/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(text);
  const month=english?months.indexOf(english[1]!.toLowerCase()):-1;
  return english&&month>=0?`${english[3]}-${String(month+1).padStart(2,'0')}-${english[2]!.padStart(2,'0')}`:null;
}

/** Deterministic display cleanup for confirmed publisher chrome, including already saved bodies. */
export function cleanArticlePresentation(html:string,context:{url:string;publishedAt?:string|null}):string {
  let page:URL;try{page=new URL(context.url);}catch{return html;}
  const host=page.hostname.replace(/^www\./,''),$=cheerio.load(html,null,false);let changed=false;
  const day=context.publishedAt?beijingDate(context.publishedAt):null;
  if(host==='openai.com'||host==='developers.openai.com'){
    $('a span').each((_,node)=>{
      const element=$(node),link=element.closest('a'),text=collapseWhitespace(element.text());
      if(!/^(?:\(opens in a new window\)|（在新窗口中打开）|\(在新窗口中打开\))$/i.test(text))return;
      const copy=link.clone();copy.find('span').filter((_,span)=>collapseWhitespace($(span).text())===text).remove();
      if(!collapseWhitespace(copy.text()))return;
      element.remove();changed=true;
    });
  }
  if(host==='ghuntley.com')$('figure > a').each((_,node)=>{
    const paragraphs=$(node).children('p');
    if(paragraphs.length===2&&!paragraphs.find('img,video,picture').length&&collapseWhitespace(paragraphs.eq(0).text())===collapseWhitespace(paragraphs.eq(1).text())){
      paragraphs.eq(1).remove();changed=true;
    }
  });
  if(host==='browser-use.com'){
    const first=$.root().children().first();
    if(first.is('ul')){
      const names=first.children('li').toArray().map(node=>collapseWhitespace($(node).text()));
      if(names.length>1&&names.every(name=>/^.+\s*[（(][^()（）]+[)）]$/.test(name))){first.replaceWith($('<p>').text('Authors: '+names.join('; ')));changed=true;}
    }
    $(':is(h2,h3,h4,h5) a').each((_,node)=>{
      const link=$(node),images=link.find('img');if(images.length!==1||link.text().trim()||!['','文章图表','Article figure'].includes(images.attr('alt')??''))return;
      try{const target=new URL(link.attr('href')??'',page);if(!target.hash)return;target.hash='';const original=new URL(page);original.hash='';
        if(target.href===original.href){link.remove();changed=true;}
      }catch{}
    });
  }
  if(day&&(host==='developers.googleblog.com'||host==='browser-use.com')){
    const children=$.root().children(),first=children.first();
    const candidate=host==='browser-use.com'&&/^Authors:|^作者[：:]/.test(first.text())?children.eq(1):first;
    if(candidate.is('p')){
      const copy=candidate.clone();
      if(host==='browser-use.com')copy.children('span').filter((_,node)=>/^(?:Research|Engineering|研究|工程)$/.test($(node).text().trim())).remove();
      const text=host==='browser-use.com'?copy.text().replace(/\s*(?:Research|Engineering|研究|工程)$/,''):copy.text();
      if(dateOnly(text)===day){candidate.remove();changed=true;}
    }
  }
  if(host==='blogs.microsoft.com'){
    const last=$.root().children().last(),text=collapseWhitespace(last.text());
    if(last.is('p')&&/^(?:The post\b.+appeared first on\b|(?:帖子|文章|本文).+(?:最初|最早|首次)发布于)/i.test(text)&&last.find('a').toArray().some(node=>{
      try{const target=new URL($(node).attr('href')??'',page);target.hash='';return target.href===page.href;}catch{return false;}
    })){last.remove();changed=true;}
  }
  return changed?$.html():html;
}
