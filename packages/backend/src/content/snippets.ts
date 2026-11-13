import {collapseWhitespace} from '../lib/text.ts';

type SummaryContext={title?:string;url?:string;truncated?:boolean};
const tags=(text:string):string[]=>text.match(/<\/?[a-zA-Z][^<>]*>/g)??[];

/** Metadata is text; retain tag-shaped literals that were already in the source. */
export function metadataAddsMarkup(source:string,translated:string):boolean {
  const allowed=tags(source);
  return tags(translated).some(tag=>{const at=allowed.indexOf(tag);if(at<0)return true;allowed.splice(at,1);return false;});
}

/** Older model responses used the body's link wrappers even for plain snippets. */
export function plainMetadata(translated:string,source:string):string {
  const allowed=tags(source);
  return collapseWhitespace(translated.replace(/<\/?[a-zA-Z][^<>]*>/g,tag=>{
    const at=allowed.indexOf(tag);if(at<0)return '';allowed.splice(at,1);return tag;
  }));
}

export function cleanSummary(input:string|null,context:SummaryContext={}):string|null {
  if(input===null)return null;
  let text=collapseWhitespace(input),host='';
  try{host=new URL(context.url??'').hostname.replace(/^www\./,'');}catch{/* An unparsable URL keeps host-specific rules off. */}
  if(host==='uber.com'&&/^uber[.!。]?$/i.test(text))return null;
  // Ghost repeats the callout icon in its preview; the icon is publisher chrome, not the summary.
  if(host==='ghuntley.com')text=text.replace(/^(?:\p{Extended_Pictographic}|\uFE0F|\u200D)+(?=\S)/u,'');
  if(host==='ghuntley.com'&&/^0:00\s*\/\s*\d{1,2}:\d{2}(?::\d{2})?\s+1[×x]\s+/.test(text)){
    text=text.replace(/^0:00\s*\/\s*\d{1,2}:\d{2}(?::\d{2})?\s+1[×x]\s+/,'').replace(/\s+\*\s+/g,' ');
  }
  if(context.title){
    const title=context.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    text=text.replace(new RegExp(`\\s+The post ${title} appeared first on [^\\n]+?[.]?\\s*$`,'i'),'').trim();
    if(host==='blogs.microsoft.com')text=text.replace(new RegExp(`\\s*(?:(?:本文|文章|帖子)\\s*)?[《「“]?${title}[》」”]?\\s*(?:一文)?(?:最初|最早|首次)发布于[^。]+。$`),'').trim();
  }
  // Ghost's upstream preview can stop inside an escaped apostrophe. Keep its last intact sentence.
  if(host==='ghuntley.com'&&/\S&$/.test(text)){
    const boundary=text.search(/[.!?。！？][^.!?。！？]*&$/u);
    text=boundary>=0?text.slice(0,boundary+1):text.slice(0,-1);
  }
  if(context.truncated){
    let end=0;
    for(const match of text.matchAll(/(?<!\.)[.!?](?!\.)(?:["'”’）)\]]+)?(?=\s|$|\p{Script=Han})|[。！？](?:["'”’）)\]]+)?/gu)){
      // Prefer an earlier sentence to leaving a preview cut at an abbreviation or initial.
      if(match[0].startsWith('.')&&/\b(?:[a-z]|Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Fig|Eq|No|Inc|Ltd)\.$/i.test(text.slice(0,match.index+1)))continue;
      end=match.index+match[0].length;
    }
    if(end>0&&end<text.length)text=text.slice(0,end).trimEnd();
  }
  return text||null;
}
