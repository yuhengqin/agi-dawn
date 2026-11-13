import {collapseWhitespace} from '../lib/text.ts';

type SummaryContext={title?:string;url?:string};
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
  try{host=new URL(context.url??'').hostname.replace(/^www\./,'');}catch{}
  if(host==='uber.com'&&/^uber[.!。]?$/i.test(text))return null;
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
  return text||null;
}
