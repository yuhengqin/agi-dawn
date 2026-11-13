import * as cheerio from 'cheerio';
import {beijingDate} from '@agidawn/contracts/time';
import {collapseWhitespace} from '../lib/text.ts';
import type {BodyIssue} from '@agidawn/contracts/site';
import {restoreFootnotes} from './footnotes.ts';
import {normalizeOpenAIFigures} from './openai-presentation.ts';

export function figurePresentationIssues(html:string):BodyIssue[]{
  return html.includes('data-reader-figure-status="missing"')?[{kind:'missing-figure',message:'部分图表未保存，请通过图示旁的链接查看原文。'}]:[];
}

const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function dateOnly(value:string):string|null {
  const text=collapseWhitespace(value),chinese=/^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text.replace(/\s+/g,''));
  if(chinese)return `${chinese[1]}-${chinese[2]!.padStart(2,'0')}-${chinese[3]!.padStart(2,'0')}`;
  const reordered=text.replace(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i,'$2 $1, $3');
  const english=/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(reordered);
  const month=english?months.indexOf(english[1]!.toLowerCase()):-1;
  return english&&month>=0?`${english[3]}-${String(month+1).padStart(2,'0')}-${english[2]!.padStart(2,'0')}`:null;
}

/** Deterministic display cleanup for confirmed publisher chrome, including already saved bodies. */
export function cleanArticlePresentation(html:string,context:{url:string;publishedAt?:string|null;issues?:readonly BodyIssue[];author?:string|null}):string {
  let page:URL;try{page=new URL(context.url);}catch{return html;}
  const linked=restoreFootnotes(html,context.url),host=page.hostname.replace(/^www\./,''),$=cheerio.load(linked,null,false);let changed=linked!==html;
  const day=context.publishedAt?beijingDate(context.publishedAt):null;
  const first=$.root().children().first(),leading=collapseWhitespace(first.text());
  if(day&&first.is('p')){
    const byline=/^(?:By|作者)\s+Geoffrey Huntley\s*(?:in\s+|[，,]\s*)?AI\s*[—-]\s*(.+)$/i.exec(leading);
    if(host==='ghuntley.com'&&byline&&[day,context.publishedAt?.slice(0,10)].some(value=>value===dateOnly(byline[1]!))){first.remove();changed=true;}
    if(host==='developers.openai.com'&&dateOnly(leading.replace(/\s+(?:Audio|音频)$/i,''))===day){first.remove();changed=true;}
  }
  if(host==='developers.googleblog.com'&&first.is('p')&&context.author){
    const compact=leading.replace(/\s+/g,''),known=context.author.split(/[,;、]/).some(name=>compact.startsWith(name.trim().replace(/\s+/g,'')));
    if(known&&/(?:SoftwareEngineeringIntern|SoftwareEngineerIntern|软件工程实习生)GoogleCloud$/i.test(compact)){first.remove();changed=true;}
  }
  $('a').filter((_,node)=>!$(node).attr('href')&&!$(node).attr('id')).each((_,node)=>{$(node).replaceWith($(node).contents());changed=true;});
  if(host==='claude.dev'||host==='anthropic.com'){
    $('figure video[poster]').each((_,node)=>{
      const video=$(node),holder=video.parent().is('p')?video.parent():video,next=holder.next('p'),image=next.children('img');
      if(image.length!==1||next.children().length!==1||next.text().trim()||!video.attr('width')||!video.attr('height'))return;
      try{if(new URL(video.attr('poster')!,page).href!==new URL(image.attr('src')??'',page).href)return;}catch{return;}
      if(video.attr('width')!==image.attr('width')||video.attr('height')!==image.attr('height'))return;
      const description=image.attr('alt')?.trim(),label=video.attr('aria-label');if(label&&description&&label!==description)return;
      if(description)video.attr('aria-label',description);next.remove();changed=true;
    });
    $('figcaption > b,figcaption > strong').each((_,node)=>{
      if(!/^(?:图|figure)\s*[\dA-Z]+$/i.test($(node).text().trim())||node.next?.type!=='tag'||node.next.name!=='span')return;
      $(node).after(' ');changed=true;
    });
    $('pre').each((_,node)=>{
      const pre=$(node),head=pre.prev('p'),match=/^CODE\s*(JavaScript|TypeScript|Python|Shell|Bash|Text|JSON|SQL|Go|Rust|CSS|HTML)$/i.exec(head.text().trim());
      if(!match||head.find('a,img,video,code').length)return;
      const language=match[1]!.toLowerCase(),declared=pre.attr('data-language');
      if(declared&&declared!==language)return;
      pre.attr('data-language',language);pre.find('code').first().addClass(`language-${language}`);head.remove();changed=true;
    });
  }
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
    const metadata=card.children('p').last(),text=metadata.text(),separated=text.replace(/^(GitHub|The Register|Latent Patterns|One Useful Thing)(?=\S)/,'$1 · ');
    if(separated!==text&&!metadata.find('a,img,video').length){metadata.text(separated);changed=true;}
    const visit=(element:import('domhandler').AnyNode)=>{if(element.type==='text'){const next=element.data.replace(/&#(?:0*39|x0*27);/gi,"'");if(next!==element.data){element.data=next;changed=true;}}else if('children'in element&&!(element.type==='tag'&&['pre','code'].includes(element.name)))for(const child of element.children)visit(child);};visit(node);
  });
  if(host==='ghuntley.com')$('video').each((_,node)=>{
    const holder=$(node).parent().is('p')?$(node).parent():$(node),clock=holder.next('p'),duration=clock.next('p');
    if(clock.text().trim()==='0:00'&&/^\/\s*\d{1,2}:\d{2}(?::\d{2})?$/.test(duration.text().trim())&&!clock.find('a,img,video,code').length&&!duration.find('a,img,video,code').length){clock.remove();duration.remove();changed=true;}
  });
  $('figure').each((_,node)=>{
    const figure=$(node);if(figure.is('[data-reader-card]')||figure.find('table,pre,blockquote,video,picture,ul,ol,dl').length)return;
    if(figure.children('figure[data-reader-figure-status="missing"]').length){
      const notes=figure.children('p').filter((_,paragraph)=>{
        const p=$(paragraph),a=p.children('a');return a.length===1&&p.text().trim()==='此图未保存，查看原文'&&a.attr('href')===page.href;
      }),copy=figure.clone();copy.children('figure,figcaption').remove();copy.children('p').filter((_,p)=>$(p).text().trim()==='此图未保存，查看原文').remove();
      if(!copy.text().trim()&&!copy.find('img').length){notes.remove();figure.removeAttr('data-reader-figure-status data-reader-figure-loss');changed=true;return;}
    }
    if(figure.children('[data-reader-embed]').length){
      if(figure.is('[data-reader-figure-status="missing"]')){
        figure.children('p').filter((_,paragraph)=>/^此图未保存[，,]\s*查看原文$/.test($(paragraph).text().trim())).remove();
        figure.removeAttr('data-reader-figure-status');changed=true;
      }
      return;
    }
    const usefulImage=figure.find('img').toArray().some(image=>{
      const img=$(image),width=Number(img.attr('width')),height=Number(img.attr('height'));
      return img.attr('data-reader-inline')!=='true'&&!(width>0&&height>0&&Math.max(width,height)<=32);
    });
    if(usefulImage)return;
    const copy=figure.clone();copy.find('figcaption,h2,h3,h4,[data-reader-embed]').remove();
    const captionOnly=!!figure.find('figcaption').length&&!copy.text().trim();
    const recordedLoss=figure.is('[data-reader-figure-loss="true"]');
    if(!captionOnly&&!recordedLoss&&!figure.is('[data-reader-figure-status="missing"]'))return;
    if(figure.is('[data-reader-figure-status="missing"]'))return;
    figure.attr('data-reader-figure-status','missing').removeAttr('data-reader-figure-loss');
    if(host==='openai.com')figure.find('p,span').filter((_,element)=>/^(?:Select a branch to include|选择一个分支以包含|Held\s*Fetch\s*Missing|已持有获取缺失的分支依赖项)/i.test(collapseWhitespace($(element).text()))).remove();
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
  if(host==='openai.com')changed=normalizeOpenAIFigures($,page)||changed;
  return changed?$.html():html;
}
