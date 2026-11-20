/** Shared public matching semantics: Chinese substrings and complete English technical words. */
export function searchWords(query:string):string[]{
  return query.toLowerCase().replace(/(\p{Script=Han})(?=[a-z])/gu,'$1 ').replace(/([a-z][a-z0-9]*)(?=\p{Script=Han})/gu,'$1 ')
    .split(/\s+/).filter(Boolean);
}
export function searchPattern(word:string):string{
  const literal=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return /[a-z0-9_]/i.test(word)?`(?<![a-z0-9_])${literal}(?![a-z0-9_])`:literal;
}
export function matchRanges(text:string,words:readonly string[]):Array<{start:number;end:number}>{
  const ranges=words.flatMap(word=>[...text.matchAll(new RegExp(searchPattern(word),'gi'))].map(match=>({start:match.index,end:match.index+match[0].length}))).sort((a,b)=>a.start-b.start||b.end-a.end);
  const result:Array<{start:number;end:number}>=[];
  for(const range of ranges){const previous=result.at(-1);if(previous&&range.start<=previous.end)previous.end=Math.max(previous.end,range.end);else result.push({...range});}
  return result;
}
/** Keep the entire first matched keyword inside the snippet even for long technical queries. */
export function searchSnippet(text:string,words:readonly string[]):string{
  const first=matchRanges(text,words)[0];
  const chars=[...text];
  const matchStart=first?[...text.slice(0,first.start)].length:0;
  const matchLen=first?[...text.slice(first.start,first.end)].length:0;
  const room=Math.max(160,matchLen+24);
  const lead=Math.min(45,Math.max(0,Math.floor((room-matchLen)/2)));
  const start=Math.max(0,matchStart-lead);
  const prefix=start?'…':'';
  const body=room-prefix.length;
  const suffix=chars.length-start>body?'…':'';
  return prefix+chars.slice(start,start+body-suffix.length).join('')+suffix;
}
/** Approximate full-width character prefix reliably visible before a 2-line card clamp. */
export function visibleSummaryPrefix(text:string,maxUnits:number):string{
  let units=0,out='';
  for(const ch of text){
    units+=/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe10-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch)?1:0.55;
    if(units>maxUnits)break;
    out+=ch;
  }
  return out;
}
