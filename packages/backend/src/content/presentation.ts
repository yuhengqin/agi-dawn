import * as cheerio from 'cheerio';
import {beijingDate} from '@agidawn/contracts/time';
import {collapseWhitespace} from '../lib/text.ts';
import type {BodyIssue} from '@agidawn/contracts/site';
import {restoreFootnotes} from './footnotes.ts';

export function figurePresentationIssues(html:string):BodyIssue[]{
  return html.includes('data-reader-figure-status="missing"')?[{kind:'missing-figure',message:'部分图表未保存，请通过图示旁的链接查看原文。'}]:[];
}

const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function dateOnly(value:string):string|null {
  const text=collapseWhitespace(value),chinese=/^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text);
  if(chinese)return `${chinese[1]}-${chinese[2]!.padStart(2,'0')}-${chinese[3]!.padStart(2,'0')}`;
  const english=/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(text);
  const month=english?months.indexOf(english[1]!.toLowerCase()):-1;
  return english&&month>=0?`${english[3]}-${String(month+1).padStart(2,'0')}-${english[2]!.padStart(2,'0')}`:null;
}

/** Deterministic display cleanup for confirmed publisher chrome, including already saved bodies. */
export function cleanArticlePresentation(html:string,context:{url:string;publishedAt?:string|null;issues?:readonly BodyIssue[]}):string {
  let page:URL;try{page=new URL(context.url);}catch{return html;}
  const linked=restoreFootnotes(html,context.url),host=page.hostname.replace(/^www\./,''),$=cheerio.load(linked,null,false);let changed=linked!==html;
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
  if(host==='ghuntley.com')$('a').each((_,node)=>{
    const link=$(node),blocks=link.children('p,h2,h3,h4').filter((_,block)=>!!$(block).text().trim()),images=link.find('img').clone();
    if(!link.closest('figure').length||blocks.length<1||link.find('video').length||images.length&&blocks.length<2||!link.attr('href'))return;
    const title=collapseWhitespace(blocks.first().text());if(!title)return;
    const card=link.closest('figure').attr('data-reader-card','true');
    const head=$('<p>').append($('<a>').attr('href',link.attr('href')!).text(title));
    const description=blocks.slice(1).map((_,block)=>collapseWhitespace($(block).text())).get().filter(text=>text&&text!==title);
    const thumbnails=images.toArray().map(image=>$('<a>').attr('href',link.attr('href')!).append(image));
    link.replaceWith(thumbnails.flatMap(image=>image.toArray()).concat(head.toArray(),description.flatMap(text=>$('<p>').text(text).toArray())));
    card.find('figcaption').remove();changed=true;
  });
  if(host==='ghuntley.com')$('figure[data-reader-card="true"]').each((_,node)=>{
    const card=$(node),images=card.find('img');
    if(images.length>1)images.each((_,image)=>{try{if(new URL($(image).attr('src')??'').pathname.includes('/content/images/icon/')){$(image).closest('a').remove();changed=true;}}catch{}});
    card.children('p').each((_,paragraph)=>{const p=$(paragraph);if(collapseWhitespace(p.text())==='Geoffrey HuntleyGeoffrey Huntley'){p.text('Geoffrey Huntley');changed=true;}});
    const visit=(element:import('domhandler').AnyNode)=>{if(element.type==='text'){const next=element.data.replace(/&#(?:0*39|x0*27);/gi,"'");if(next!==element.data){element.data=next;changed=true;}}else if('children'in element&&!(element.type==='tag'&&['pre','code'].includes(element.name)))for(const child of element.children)visit(child);};visit(node);
  });
  $('figure').each((_,node)=>{
    const figure=$(node);if(figure.is('[data-reader-card]')||figure.find('table,pre,blockquote,video,picture').length)return;
    const usefulImage=figure.find('img').toArray().some(image=>{
      const img=$(image),width=Number(img.attr('width')),height=Number(img.attr('height'));
      return img.attr('data-reader-inline')!=='true'&&!(width>0&&height>0&&Math.max(width,height)<=32);
    });
    if(usefulImage)return;
    const copy=figure.clone();copy.find('figcaption,h2,h3,h4,[data-reader-embed]').remove();
    const captionOnly=!!figure.find('figcaption').length&&!copy.text().trim();
    const knownDrawing=(host==='openai.com'||host==='claude.dev')&&figure.find('figcaption').length>0&&!figure.find('a').length;
    const recordedLoss=figure.is('[data-reader-figure-loss="true"]')||!!figure.find('figcaption').length&&context.issues?.some(issue=>issue.kind==='missing-figure');
    if(!captionOnly&&!knownDrawing&&!recordedLoss&&!figure.is('[data-reader-figure-status="missing"]'))return;
    if(figure.is('[data-reader-figure-status="missing"]'))return;
    figure.attr('data-reader-figure-status','missing').removeAttr('data-reader-figure-loss');
    if(knownDrawing)figure.find('p,span').filter((_,element)=>/^(?:Select a branch to include|选择一个分支以包含|Held\s*Fetch\s*Missing|已持有获取缺失的分支依赖项)/i.test(collapseWhitespace($(element).text()))).remove();
    figure.prepend($('<p>').append($('<a>').attr('href',page.href).text('此图未保存，查看原文')));changed=true;
  });
  $('p').each((_,node)=>{
    const p=$(node);if(p.find('a').length||!/^互动内容请访问原文查看[。.]?$/.test(p.text().trim()))return;
    p.attr('data-reader-embed','true').empty().append($('<a>').attr('href',page.href).text('互动内容请访问原文查看。'));changed=true;
  });
  if(host==='browser-use.com'){
    $('img').each((_,node)=>{try{let image=new URL($(node).attr('src')??'',page);if(image.pathname==='/_next/image'&&image.searchParams.get('url'))image=new URL(image.searchParams.get('url')!,page);
      if(image.pathname.includes('/benchmark-behind-the-benchmark/')){$(node).attr('data-reader-image-surface','dark');changed=true;}
    }catch{}});
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
  $('p').each((_,node)=>{
    const p=$(node),previous=p.prev();
    if(/^(?:Sorry, your browser (?:doesn['’]t support playback for this video|does not support (?:this video|the video tag))\.?|(?:抱歉[，,]\s*)?[您你]的浏览器不支持(?:此视频的播放|播放此视频|此视频|视频标签)[。.!！]?)$/.test(collapseWhitespace(p.text()))
      &&(previous.is('video')||previous.is('p')&&previous.children('video').length)){p.remove();changed=true;}
  });
  if(host==='blog.sshh.io'){
    $.root().children('p').each((_,node)=>{
      const paragraph=$(node),text=collapseWhitespace(paragraph.text());
      const promotionalText=/^Thanks for reading Shrivu[’']s Substack! Subscribe for free to receive new posts and support my work\.$/.test(text)||/^感谢阅读\s*Shrivu\s*的\s*Substack[！!]\s*免费订阅(?:以|即可)接收新文章并支持我的工作[。.]$/.test(text);
      if(promotionalText&&!paragraph.find('img,video,pre,code,table').length){
        paragraph.remove();changed=true;return;
      }
      const links=paragraph.find('a');
      if(links.length!==1)return;
      const link=links.first(),linkText=collapseWhitespace(link.text());
      if(text!==linkText||!['Share','分享'].includes(text))return;
      try{
        const target=new URL(link.attr('href')??'',page);
        if(target.origin===page.origin&&target.pathname===page.pathname&&target.searchParams.get('action')==='share'){
          paragraph.remove();changed=true;
        }
      }catch{}
    });
    const children=$.root().children(),last=children.last(),candidate=last.is('hr')?children.eq(children.length-2):last;
    if(candidate.is('p')&&['No posts','无帖子'].includes(collapseWhitespace(candidate.text()))){candidate.remove();changed=true;}
  }
  return changed?$.html():html;
}
