import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as cheerio from 'cheerio';

const cssFile=createRequire(import.meta.url).resolve('katex/dist/katex.min.css');
const css=readFileSync(cssFile,'utf8');
const classes=new Set([...css.matchAll(/([^{}]+)\{/g)].flatMap(match=>[...match[1]!.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(item=>item[1]!)));
for(const name of ['mord','mopen','mclose','mop','mrel','mbin','minner','mpunct','mtight','text'])classes.add(name);
// KaTeX 0.19 prefixed these layout classes; older publisher output uses the same layout vocabulary.
const legacy:Record<string,string>={base:'katex-base',strut:'katex-strut',sizing:'katex-sizing',stretchy:'katex-stretchy',accent:'katex-accent'};
const lengths=new Set(['height','width','min-width','min-height','max-width','top','bottom','left','right','vertical-align','margin-left','margin-right','margin-top','margin-bottom','padding-left','padding-right','padding-top','padding-bottom','border-bottom-width']);
const length=/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:em|ex|px|%)?$/;
const color=/^(?:#[a-f\d]{3,8}|currentColor|transparent|none)$/i;

/** HTML-only KaTeX is a layout tree, not text in DOM order. Keep only its fixed renderer vocabulary. */
export function cleanKatex(fragment:string):string|null{
  if(fragment.length>256*1024)return null;
  const $=cheerio.load(fragment,null,false),root=$.root();
  const wrapped=root.children('[data-reader-math="katex"]');if(wrapped.length===1)wrapped.replaceWith(wrapped.contents());
  if(root.children().length!==1||!root.children().is('.katex,.katex-display')||!root.find('.katex').length)return null;
  const nodes=root.find('*').toArray();if(nodes.length>3000)return null;
  for(const node of nodes){
    const tag=node.tagName,el=$(node);
    if(!['span','svg','path'].includes(tag))return null;
    for(const [name,value] of Object.entries(node.attribs)){
      if(/^on/i.test(name))return null;
      if(name==='class'){
        const names=value.split(/\s+/).filter(Boolean).map(word=>legacy[word]??word);
        if(names.some(word=>!classes.has(word)))return null;el.attr('class',names.join(' '));
      }else if(name==='style'&&tag==='span'){
        const normalized:string[]=[];
        for(const part of value.split(';')){
          if(!part.trim())continue;const at=part.indexOf(':'),key=part.slice(0,at).trim(),v=part.slice(at+1).trim();
          if(at<0||!(lengths.has(key)&&length.test(v)&&Math.abs(parseFloat(v))<=1000||key==='color'&&color.test(v)||key==='position'&&v==='relative'))return null;
          normalized.push(`${key}:${v}`);
        }
        if(normalized.length)el.attr('style',normalized.join(';'));else el.removeAttr('style');
      }else if(tag==='svg'&&['width','height'].includes(name)&&length.test(value))continue;
      else if(tag==='svg'&&name==='viewBox'&&/^[-\d.\s]+$/.test(value)&&value.trim().split(/\s+/).length===4)continue;
      else if(tag==='svg'&&name==='preserveAspectRatio'&&/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value))continue;
      else if(tag==='svg'&&name==='xmlns'&&value==='http://www.w3.org/2000/svg')continue;
      else if(tag==='path'&&name==='d'&&value.length<=128*1024&&/^[MmZzLlHhVvCcSsQqTtAa\dEe+.,\s-]+$/.test(value))continue;
      else if(['svg','path'].includes(tag)&&name==='fill'&&color.test(value))continue;
      else if(['aria-hidden','aria-label','role'].includes(name))el.removeAttr(name);
      else return null;
    }
  }
  return $('<span>').attr({'data-reader-math':'katex',role:'img','aria-label':'数学公式'}).append(root.contents()).toString();
}

/** Only placeholders surviving article selection are restored; publisher scripts are never evaluated. */
export function protectKatex(html:string){
  const $=cheerio.load(html,null,false),prefix='READERMATH'+randomUUID().replaceAll('-',''),values:string[]=[];
  $('[data-reader-math="katex"]').each((_,node)=>{
    const clean=cleanKatex($.html(node));if(!clean)return;
    const token=prefix+values.length;values.push(clean);$(node).replaceWith($('<code>').text(token));
  });
  return {html:$.html(),restore:(result:string)=>result.replace(new RegExp(`<code>${prefix}(\\d+)</code>`,'g'),(match,index:string)=>values[Number(index)]??match)};
}

/** Offline HTML uses exactly the same versioned stylesheet and fonts as the web bundle. */
export async function mathResources(){
  const fonts=[...new Set([...css.matchAll(/url\(["']?(fonts\/[\w.-]+)["']?\)/g)].map(match=>match[1]!))];
  const names=['katex.min.css',...fonts];
  const files=await Promise.all(names.map(async name=>({path:'math/'+name,body:await readFile(path.join(path.dirname(cssFile),name)),mime:name.endsWith('.css')?'text/css':'font/'+(name.endsWith('.woff2')?'woff2':name.endsWith('.woff')?'woff':'ttf')})));
  files.push({path:'math/LICENSE',body:await readFile(path.join(path.dirname(cssFile),'../LICENSE')),mime:'text/plain'});
  return files;
}
